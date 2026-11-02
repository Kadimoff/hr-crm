/** Əmr əsasında ödənişsiz məzuniyyət — saf qaydalar (server, klient və testlər üçün) */

const DAY = 86_400_000;

/** Dosyedən əmr ilə daxil edilən növlər (Prisma AbsenceType-in alt çoxluğu) */
export const ORDER_LEAVE_TYPES = ["UNPAID", "SOCIAL_UNPAID"] as const;
export type OrderLeaveType = (typeof ORDER_LEAVE_TYPES)[number];

export const ORDER_LEAVE_LABELS: Record<OrderLeaveType, string> = {
  UNPAID: "Ödənişsiz məzuniyyət (ö/m)",
  SOCIAL_UNPAID: "Ödənişsiz sosial məzuniyyət (ö/sm)",
};
/** Nişan: «Ödənişsiz məzuniyyətdə (… – …)» */
export const ON_LEAVE_LABELS: Record<OrderLeaveType, string> = {
  UNPAID: "Ödənişsiz məzuniyyətdə",
  SOCIAL_UNPAID: "Ödənişsiz sosial məzuniyyətdə",
};
export const isOrderLeaveType = (v: unknown): v is OrderLeaveType => typeof v === "string" && (ORDER_LEAVE_TYPES as readonly string[]).includes(v);

/** Bütün işdə iştirak etməmə növlərinin adı (kəsişmə xətasında göstərilir) */
export const ABSENCE_TYPE_NAMES: Record<string, string> = {
  SICK: "xəstəlik",
  UNKNOWN: "naməlum səbəb",
  SOCIAL_PAID: "sosial məzuniyyət (sm)",
  SOCIAL_UNPAID: "ödənişsiz sosial məzuniyyət (ö/sm)",
  UNPAID: "ödənişsiz məzuniyyət (ö/m)",
};

export interface AbsenceLike {
  id: string;
  type: string;
  startDate: Date;
  endDate: Date;
  cancelledAt?: Date | null;
}

/** Hər iki gün daxil olmaqla gün sayı */
export const leaveDays = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / DAY) + 1;

/** [start, end] ilə kəsişən ilk ləğv edilməmiş qeyd (exceptId — redaktə olunan qeydin özü) */
export function findOverlap<T extends AbsenceLike>(start: Date, end: Date, existing: T[], exceptId?: string): T | null {
  return existing.find((a) => !a.cancelledAt && a.id !== exceptId && a.startDate <= end && a.endDate >= start) ?? null;
}

export interface LeaveCheckInput {
  orderDate: Date;
  startDate: Date;
  endDate: Date;
}

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

/**
 * Qaydalar: əmrin tarixi gələcəkdə ola bilməz; bitmə ≥ başlama; başlama — işə qəbul tarixindən (ən erkən aktiv müqavilə) əvvəl ola bilməz;
 * əməkdaşın başqa (ləğv edilməmiş) iştirak etməmə dövrü ilə kəsişə bilməz. Başlama və bitmə gələcəkdə ola bilər (irəli dövrə məzuniyyət).
 */
export function leaveError(v: LeaveCheckInput, ctx: { today: Date; hireDate: Date | null; existing: AbsenceLike[] }): { field: string; message: string } | null {
  if (v.orderDate > ctx.today) return { field: "orderDate", message: "Əmrin tarixi gələcəkdə ola bilməz" };
  if (v.endDate < v.startDate) return { field: "endDate", message: "Bitmə tarixi başlama tarixindən əvvəl ola bilməz" };
  if (ctx.hireDate && v.startDate < ctx.hireDate) return { field: "startDate", message: `Başlama tarixi işə qəbul tarixindən (${ddmmyyyy(ctx.hireDate)}) əvvəl ola bilməz` };
  if (leaveDays(v.startDate, v.endDate) > 366 * 3) return { field: "endDate", message: "Məzuniyyət dövrü çox uzundur — tarixləri yoxlayın" };
  const o = findOverlap(v.startDate, v.endDate, ctx.existing);
  if (o)
    return {
      field: "startDate",
      message: `Bu dövr əməkdaşın ${ABSENCE_TYPE_NAMES[o.type] ?? "başqa"} dövrü ilə (${ddmmyyyy(o.startDate)} – ${ddmmyyyy(o.endDate)}) kəsişir`,
    };
  return null;
}

/** Göstərilən gündə davam edən (ləğv edilməmiş) ödənişsiz məzuniyyət — dosyedə və siyahıda nişan üçün */
export function activeUnpaidLeave<T extends AbsenceLike>(absences: T[], day: Date): T | null {
  return absences.find((a) => !a.cancelledAt && isOrderLeaveType(a.type) && a.startDate <= day && a.endDate >= day) ?? null;
}
