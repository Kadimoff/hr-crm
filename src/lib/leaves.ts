import "server-only";
import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { todayUtc } from "@/lib/calc/seniority";
import { formatAzDate } from "@/lib/validation/primitives";
import { leaveDays, leaveError, ORDER_LEAVE_LABELS, type OrderLeaveType } from "./leave-rules";
import { MovementError } from "./movements";

export interface LeaveInput {
  personId: string;
  expectedUpdatedAt?: string;
  type: OrderLeaveType;
  orderNumber: string;
  orderDate: Date;
  startDate: Date;
  endDate: Date;
  note?: string;
}

/**
 * Əmr əsasında ödənişsiz məzuniyyət — Absence qeydi (əmr məlumatı ilə). Staj hesablaması (ö/m), dosyedəki nişan,
 * hərəkət tarixçəsi və «Kadr hərəkəti» hesabatı birbaşa buradan oxuyur. Kəsişən dövr və bitmə < başlama rədd edilir.
 */
export async function applyLeave(tx: Prisma.TransactionClient, user: Pick<CurrentUser, "id" | "username">, input: LeaveInput): Promise<{ absenceId: string; summary: string }> {
  // Eyni şəxs üçün paralel iki sorğu kəsişmə yoxlamasından birlikdə keçməsin — şəxsin sətri kilidlənir
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id = ${input.personId} FOR UPDATE`;
  const person = await tx.person.findFirst({
    where: { id: input.personId, deletedAt: null },
    select: { id: true, fullName: true, code: true, updatedAt: true, employments: { where: { status: { not: "TERMINATED" } }, select: { hireDate: true }, orderBy: { hireDate: "asc" } } },
  });
  if (!person) throw new MovementError("Əməkdaş tapılmadı və ya arxivdədir");
  if (input.expectedUpdatedAt && person.updatedAt.toISOString() !== input.expectedUpdatedAt)
    throw new MovementError("Bu əməkdaşın məlumatlarını siz formanı açandan sonra başqa istifadəçi dəyişib. Səhifəni yeniləyin və yenidən daxil edin.");
  if (person.employments.length === 0) throw new MovementError("Əməkdaşın aktiv əmək müqaviləsi yoxdur — məzuniyyət yazılmır");

  const existing = await tx.absence.findMany({ where: { personId: person.id, cancelledAt: null }, select: { id: true, type: true, startDate: true, endDate: true } });
  const err = leaveError(input, { today: todayUtc(), hireDate: person.employments[0]!.hireDate, existing });
  if (err) throw new MovementError(err.message, err.field);

  const created = await tx.absence.create({
    data: {
      personId: person.id,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      orderNumber: input.orderNumber,
      orderDate: input.orderDate,
      note: input.note ?? null,
      createdById: user.id,
    },
    select: { id: true },
  });
  await tx.person.update({ where: { id: person.id }, data: { updatedById: user.id } });
  const days = leaveDays(input.startDate, input.endDate);
  const summary = `${ORDER_LEAVE_LABELS[input.type]}: ${person.fullName} (${person.code}) — ${formatAzDate(input.startDate)} – ${formatAzDate(input.endDate)} (${days} gün), əmr № ${input.orderNumber} (${formatAzDate(input.orderDate)})`;
  await audit(
    {
      user,
      action: "CREATE",
      entity: "Person",
      entityId: person.id,
      summary,
      changes: {
        absenceId: created.id,
        type: input.type,
        startDate: formatAzDate(input.startDate),
        endDate: formatAzDate(input.endDate),
        days,
        orderNumber: input.orderNumber,
        orderDate: formatAzDate(input.orderDate),
        ...(input.note ? { note: input.note } : {}),
      },
    },
    tx,
  );
  return { absenceId: created.id, summary };
}

/** Səhv daxil edilmiş əmrli məzuniyyətin ləğvi: qeyd silinmir — cancelledAt / kim / səbəb yazılır, audit jurnalına düşür */
export async function cancelLeave(tx: Prisma.TransactionClient, user: Pick<CurrentUser, "id" | "username">, absenceId: string, reason: string): Promise<{ personId: string; summary: string }> {
  const a = await tx.absence.findUnique({ where: { id: absenceId }, include: { person: { select: { id: true, fullName: true, code: true, deletedAt: true } } } });
  if (!a || a.person.deletedAt) throw new MovementError("Qeyd tapılmadı");
  if (!a.orderNumber) throw new MovementError("İdxaldan gələn qeyd buradan ləğv edilmir — idxal faylında düzəldin");
  if (a.cancelledAt) throw new MovementError("Bu qeyd artıq ləğv edilib");
  const updated = await tx.absence.updateMany({ where: { id: a.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason } });
  if (updated.count === 0) throw new MovementError("Bu qeyd artıq ləğv edilib");
  await tx.person.update({ where: { id: a.personId }, data: { updatedById: user.id } });
  const label = ORDER_LEAVE_LABELS[a.type as OrderLeaveType] ?? "Məzuniyyət";
  const summary = `${label} ləğv edildi: ${a.person.fullName} (${a.person.code}) — ${formatAzDate(a.startDate)} – ${formatAzDate(a.endDate)}, əmr № ${a.orderNumber}. Səbəb: ${reason}`;
  await audit(
    {
      user,
      action: "UPDATE",
      entity: "Person",
      entityId: a.personId,
      summary,
      changes: { absenceId: a.id, cancelled: [null, formatAzDate(todayUtc())], reason, startDate: formatAzDate(a.startDate), endDate: formatAzDate(a.endDate), orderNumber: a.orderNumber },
    },
    tx,
  );
  return { personId: a.personId, summary };
}
