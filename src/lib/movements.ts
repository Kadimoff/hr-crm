import "server-only";
import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { formatAzDate } from "@/lib/validation/primitives";
import { describeMovement, type MovementInput } from "./movement-rules";

const DAY = 86_400_000;

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/** İstifadəçiyə göstərilən xəta (sahə ilə) — tranzaksiya geri qaytarılır */
export class MovementError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * Kadr hərəkətini (köçürmə / oklad / ştat payı dəyişikliyi) tətbiq edir — bir tranzaksiya daxilində:
 *  1. müqavilə yeni vəziyyətə yenilənir;
 *  2. oklad dəyişibsə, SalaryRecord tarixçəsi qüvvəyə minmə tarixindən bağlanır / açılır;
 *  3. EmploymentMovement qeydi (əvvəl → sonra, əmr məlumatı) yaradılır — Hərəkət hesabatı buradan oxuyur;
 *  4. şəxsin updatedAt-ı yenilənir (açıq redaktə formaları köhnəlir), audit yazılır.
 */
export async function applyMovement(tx: Prisma.TransactionClient, user: Pick<CurrentUser, "id" | "username">, input: MovementInput): Promise<{ movementId: string; summary: string }> {
  const person = await tx.person.findFirst({ where: { id: input.personId, deletedAt: null }, select: { id: true, fullName: true, code: true, updatedAt: true } });
  if (!person) throw new MovementError("Əməkdaş tapılmadı və ya arxivdədir");
  if (input.expectedUpdatedAt && person.updatedAt.toISOString() !== input.expectedUpdatedAt)
    throw new MovementError("Bu əməkdaşın məlumatlarını siz formanı açandan sonra başqa istifadəçi dəyişib. Səhifəni yeniləyin və yenidən daxil edin.");

  const emp = await tx.employment.findFirst({
    where: { id: input.employmentId, personId: person.id, status: { not: "TERMINATED" } },
    include: { department: { select: { id: true, name: true } }, position: { select: { id: true, name: true } } },
  });
  if (!emp) throw new MovementError("Aktiv müqavilə tapılmadı (azad olunmuş müqaviləyə hərəkət yazılmır)", "employmentId");

  const today = todayUtc();
  if (input.orderDate > today) throw new MovementError("Əmrin tarixi gələcəkdə ola bilməz", "orderDate");
  if (input.effectiveDate > today)
    throw new MovementError("Qüvvəyə minmə tarixi gələcəkdə ola bilməz — əmri qüvvəyə mindiyi gün (və ya sonra) daxil edin", "effectiveDate");
  if (input.effectiveDate <= emp.hireDate) throw new MovementError(`Qüvvəyə minmə tarixi işə qəbul tarixindən (${formatAzDate(emp.hireDate)}) sonra olmalıdır`, "effectiveDate");
  const last = await tx.employmentMovement.findFirst({ where: { employmentId: emp.id }, orderBy: { effectiveDate: "desc" }, select: { effectiveDate: true } });
  if (last && input.effectiveDate < last.effectiveDate)
    throw new MovementError(`Bu müqavilədə ${formatAzDate(last.effectiveDate)} tarixli daha yeni hərəkət var — tarixçə ardıcıl olmalıdır`, "effectiveDate");

  const deptChanged = input.departmentId !== emp.departmentId;
  const posChanged = input.positionId !== emp.positionId;
  const salaryChanged = Number(emp.baseSalary) !== input.baseSalary;
  const shareChanged = Number(emp.unitShare) !== input.unitShare;
  if (!deptChanged && !posChanged && !salaryChanged && !shareChanged) throw new MovementError("Heç bir dəyişiklik yoxdur — yeni bölmə, vəzifə, oklad və ya ştat payını daxil edin");

  const [dept, pos] = await Promise.all([
    deptChanged ? tx.department.findUnique({ where: { id: input.departmentId }, select: { id: true, name: true, closedOn: true } }) : null,
    posChanged ? tx.position.findUnique({ where: { id: input.positionId }, select: { id: true, name: true, validTo: true } }) : null,
  ]);
  if (deptChanged && (!dept || (dept.closedOn && dept.closedOn <= input.effectiveDate))) throw new MovementError("Seçilmiş struktur bölmə mövcud deyil və ya bağlanıb", "departmentId");
  if (posChanged && (!pos || (pos.validTo && pos.validTo <= input.effectiveDate))) throw new MovementError("Seçilmiş vəzifə mövcud deyil və ya bağlanıb", "positionId");

  if (salaryChanged) {
    const history = await tx.salaryRecord.findMany({ where: { employmentId: emp.id }, orderBy: { validFrom: "desc" } });
    const open = history.find((r) => r.validTo === null) ?? history[0];
    if (open && input.effectiveDate <= open.validFrom)
      throw new MovementError(`Qüvvəyə minmə tarixi cari oklad qeydinin başlanğıcından (${formatAzDate(open.validFrom)}) sonra olmalıdır`, "effectiveDate");
    const prevEnd = new Date(input.effectiveDate.getTime() - DAY);
    // Tarixçəsi olmayan (məs. köhnə idxal) müqavilədə əvvəlki okladın dövrü də yazılır
    if (history.length === 0) await tx.salaryRecord.create({ data: { employmentId: emp.id, baseSalary: emp.baseSalary, validFrom: emp.hireDate, validTo: prevEnd } });
    else await tx.salaryRecord.updateMany({ where: { employmentId: emp.id, validTo: null }, data: { validTo: prevEnd } });
    await tx.salaryRecord.create({ data: { employmentId: emp.id, baseSalary: input.baseSalary, validFrom: input.effectiveDate } });
  }

  await tx.employment.update({
    where: { id: emp.id },
    data: { departmentId: input.departmentId, positionId: input.positionId, baseSalary: input.baseSalary, unitShare: input.unitShare },
  });

  const movement = await tx.employmentMovement.create({
    data: {
      employmentId: emp.id,
      orderNumber: input.orderNumber,
      orderDate: input.orderDate,
      effectiveDate: input.effectiveDate,
      ...(deptChanged ? { fromDepartmentId: emp.departmentId, fromDepartment: emp.department.name, toDepartmentId: dept!.id, toDepartment: dept!.name } : {}),
      ...(posChanged ? { fromPositionId: emp.positionId, fromPosition: emp.position.name, toPositionId: pos!.id, toPosition: pos!.name } : {}),
      ...(salaryChanged ? { fromSalary: emp.baseSalary, toSalary: input.baseSalary } : {}),
      ...(shareChanged ? { fromUnitShare: emp.unitShare, toUnitShare: input.unitShare } : {}),
      note: input.note ?? null,
      createdById: user.id,
    },
  });
  await tx.person.update({ where: { id: person.id }, data: { updatedById: user.id } });

  const text = describeMovement({
    fromDepartment: deptChanged ? emp.department.name : null,
    toDepartment: deptChanged ? dept!.name : null,
    fromPosition: posChanged ? emp.position.name : null,
    toPosition: posChanged ? pos!.name : null,
    fromSalary: salaryChanged ? Number(emp.baseSalary) : null,
    toSalary: salaryChanged ? input.baseSalary : null,
    fromUnitShare: shareChanged ? Number(emp.unitShare) : null,
    toUnitShare: shareChanged ? input.unitShare : null,
  });
  const summary = `Kadr hərəkəti: ${person.fullName} (${person.code}) — ${text.kind}, əmr № ${input.orderNumber} (${formatAzDate(input.orderDate)}), qüvvəyə minir ${formatAzDate(input.effectiveDate)}`;
  const changes: Record<string, unknown> = {
    orderNumber: input.orderNumber,
    orderDate: formatAzDate(input.orderDate),
    effectiveDate: formatAzDate(input.effectiveDate),
    ...(deptChanged ? { "employment.department": [emp.department.name, dept!.name] } : {}),
    ...(posChanged ? { "employment.position": [emp.position.name, pos!.name] } : {}),
    ...(salaryChanged ? { "employment.baseSalary": [Number(emp.baseSalary), input.baseSalary] } : {}),
    ...(shareChanged ? { "employment.unitShare": [Number(emp.unitShare), input.unitShare] } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  await audit({ user, action: "UPDATE", entity: "Person", entityId: person.id, summary, changes: changes as Prisma.InputJsonValue }, tx);
  return { movementId: movement.id, summary };
}
