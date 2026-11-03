import "server-only";
import type { FinanceSource, Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { formatAzDate } from "@/lib/validation/primitives";
import { logFinanceChanges, moneyValue, pctValue } from "./finance-log";
import { describeMovement, inferMovementKind, MOVEMENT_KIND_LABELS, movementKindError, type MovementInput } from "./movement-rules";
import { SALARY_LOCKED_MESSAGE, SALARY_SELF_MESSAGE, SALARY_TRANSFER_MESSAGE, type SalaryViewer } from "./salary-privacy";
import { restrictedDepartmentIds, salaryAccess } from "./salary-restriction";

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
 *  4. maliyyə tarixçəsinə (FinancialChange) köhnə → yeni dəyərlər, əmr və mənbə (hansı formadan) yazılır;
 *  5. şəxsin updatedAt-ı yenilənir (açıq redaktə formaları köhnəlir), audit yazılır.
 * Növ (köçürmə / vəzifə artımı / maaş / ştat dəyişikliyi) verilməyibsə dəyişikliyə görə təyin olunur.
 * Maaş məxfiliyi (bütün yollar — dosye forması, tam forma, struktur xəritəsi — buradan keçir):
 *  - imtiyazsız istifadəçi məxfi şəxsin okladını dəyişə bilməz;
 *  - məxfi şəxsi məxfi olmayan bölməyə köçürə bilməz;
 *  - öz müqaviləsində (hesab bağlı şəxs) heç bir dəyişiklik edə bilməz.
 */
export async function applyMovement(
  tx: Prisma.TransactionClient,
  user: Pick<CurrentUser, "id" | "username"> & SalaryViewer,
  input: MovementInput,
  source: FinanceSource = "MOVEMENT",
): Promise<{ movementId: string; summary: string }> {
  const person = await tx.person.findFirst({ where: { id: input.personId, deletedAt: null }, select: { id: true, fullName: true, code: true, updatedAt: true } });
  if (!person) throw new MovementError("Əməkdaş tapılmadı və ya arxivdədir");
  if (input.expectedUpdatedAt && person.updatedAt.toISOString() !== input.expectedUpdatedAt)
    throw new MovementError("Bu əməkdaşın məlumatlarını siz formanı açandan sonra başqa istifadəçi dəyişib. Səhifəni yeniləyin və yenidən daxil edin.");

  const emp = await tx.employment.findFirst({
    where: { id: input.employmentId, personId: person.id, status: { not: "TERMINATED" } },
    include: { department: { select: { id: true, name: true } }, position: { select: { id: true, name: true, hazardousAllowancePct: true } } },
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
  const access = await salaryAccess(tx, user, person.id);
  if (!access.privileged) {
    if (access.self) throw new MovementError(SALARY_SELF_MESSAGE);
    if (salaryChanged && !access.editable) throw new MovementError(SALARY_LOCKED_MESSAGE, "baseSalary");
    if (deptChanged && access.restricted && !(await restrictedDepartmentIds(tx)).has(input.departmentId)) throw new MovementError(SALARY_TRANSFER_MESSAGE, "departmentId");
  }
  const changed = { department: deptChanged, position: posChanged, salary: salaryChanged, unitShare: shareChanged };
  const kind = input.kind ?? inferMovementKind(changed);
  const kindError = movementKindError(kind, changed);
  if (kindError) throw new MovementError(kindError.message, kindError.field);

  const [dept, pos] = await Promise.all([
    deptChanged ? tx.department.findUnique({ where: { id: input.departmentId }, select: { id: true, name: true, closedOn: true } }) : null,
    posChanged ? tx.position.findUnique({ where: { id: input.positionId }, select: { id: true, name: true, validTo: true, hazardousAllowancePct: true } }) : null,
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
      kind,
      ...(deptChanged ? { fromDepartmentId: emp.departmentId, fromDepartment: emp.department.name, toDepartmentId: dept!.id, toDepartment: dept!.name } : {}),
      ...(posChanged ? { fromPositionId: emp.positionId, fromPosition: emp.position.name, toPositionId: pos!.id, toPosition: pos!.name } : {}),
      ...(salaryChanged ? { fromSalary: emp.baseSalary, toSalary: input.baseSalary } : {}),
      ...(shareChanged ? { fromUnitShare: emp.unitShare, toUnitShare: input.unitShare } : {}),
      note: input.note ?? null,
      createdById: user.id,
    },
  });
  await logFinanceChanges(
    tx,
    { personId: person.id, employmentId: emp.id, effectiveDate: input.effectiveDate, source, userId: user.id, orderNumber: input.orderNumber, orderDate: input.orderDate, movementId: movement.id },
    [
      ...(deptChanged ? [{ field: "DEPARTMENT" as const, oldValue: emp.departmentId, newValue: dept!.id, oldLabel: emp.department.name, newLabel: dept!.name }] : []),
      ...(posChanged
        ? [
            { field: "POSITION" as const, oldValue: emp.positionId, newValue: pos!.id, oldLabel: emp.position.name, newLabel: pos!.name },
            // Zərərli şərait əlavəsi vəzifədən gəlir — vəzifə ilə birlikdə dəyişirsə, ayrıca sətir
            { field: "HAZARDOUS_PCT" as const, oldValue: pctValue(emp.position.hazardousAllowancePct), newValue: pctValue(pos!.hazardousAllowancePct) },
          ]
        : []),
      ...(salaryChanged ? [{ field: "BASE_SALARY" as const, oldValue: moneyValue(emp.baseSalary), newValue: moneyValue(input.baseSalary) }] : []),
      ...(shareChanged ? [{ field: "UNIT_SHARE" as const, oldValue: moneyValue(emp.unitShare), newValue: moneyValue(input.unitShare) }] : []),
    ],
  );
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
  }, kind);
  const summary = `Kadr hərəkəti: ${person.fullName} (${person.code}) — ${text.kind}, əmr № ${input.orderNumber} (${formatAzDate(input.orderDate)}), qüvvəyə minir ${formatAzDate(input.effectiveDate)}`;
  const changes: Record<string, unknown> = {
    kind: MOVEMENT_KIND_LABELS[kind],
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
