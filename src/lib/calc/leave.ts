/**
 * Əmək məzuniyyəti hesablayıcısı (AR Əmək Məcəlləsi, 114–117-ci maddələr əsasında).
 *
 *   Ümumi = əsas (vəzifə üzrə 21 / 30 / 42 / 48 / 56; kvota üzrə qəbul olunanlarda fərdi say vəzifəninkini əvəz edir)
 *         + staja görə əlavə (5–10 il: +2, 10–15 il: +4, 15 ildən çox: +6)
 *         + iş şəraitinə görə əlavə (vəzifə üzrə)
 *         + 14 yaşadək uşağı olan qadınlara əlavə (2 uşaq və ya 18 yaşadək əlil uşaq: +2, 3+ uşaq: +5)
 */
import { addYearsUtc, DAY_MS } from "./seniority";

export interface LeaveInput {
  basicLeaveDays: number;
  hazardousLeaveDays: number;
  seniorityYears: number; // ümumi əmək stajı (kəsrli il)
  gender: "MALE" | "FEMALE";
  children: { birthDate: Date; isDisabled: boolean }[];
  /** "Kvota üzrə əsas məzuniyyət günlərinin miqdarı" — varsa vəzifənin əsas məzuniyyətini əvəz edir */
  quotaBasicLeaveDays: number | null;
  /** İş ilinin başlanğıcı — uşaqların yaşı bu tarixə görə yoxlanılır */
  periodStart: Date;
}

export interface LeaveEntitlement {
  basic: number;
  basicFromQuota: boolean;
  seniority: number;
  hazardous: number;
  motherhood: number;
  total: number;
}

export function seniorityExtraDays(years: number): number {
  if (years >= 15) return 6;
  if (years >= 10) return 4;
  if (years >= 5) return 2;
  return 0;
}

function ageOn(birth: Date, on: Date): number {
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const m = on.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export function motherhoodExtraDays(gender: LeaveInput["gender"], children: LeaveInput["children"], on: Date): number {
  if (gender !== "FEMALE") return 0;
  const under14 = children.filter((c) => c.birthDate <= on && ageOn(c.birthDate, on) < 14).length;
  const disabledUnder18 = children.some((c) => c.isDisabled && c.birthDate <= on && ageOn(c.birthDate, on) < 18);
  if (under14 >= 3) return 5;
  if (under14 >= 2 || disabledUnder18) return 2;
  return 0;
}

export function computeLeaveEntitlement(input: LeaveInput): LeaveEntitlement {
  const basicFromQuota = input.quotaBasicLeaveDays !== null;
  const basic = input.quotaBasicLeaveDays ?? input.basicLeaveDays;
  const seniority = seniorityExtraDays(input.seniorityYears);
  const hazardous = input.hazardousLeaveDays;
  const motherhood = motherhoodExtraDays(input.gender, input.children, input.periodStart);
  return { basic, basicFromQuota, seniority, hazardous, motherhood, total: basic + seniority + hazardous + motherhood };
}

/** Verilən tarixi əhatə edən iş ili (işə qəbul ildönümündən başlayaraq) */
export function workYearContaining(hireDate: Date, on: Date): { start: Date; end: Date } {
  let start = hireDate;
  while (addYearsUtc(start, 1) <= on) start = addYearsUtc(start, 1);
  return { start, end: new Date(addYearsUtc(start, 1).getTime() - DAY_MS) };
}
