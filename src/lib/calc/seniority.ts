/**
 * Staj hesablayıcısı.
 *
 * Konvensiya: kadr praktikasında olduğu kimi staj il/ay/gün kimi saxlanılır və toplanır
 * (30 gün = 1 ay, 12 ay = 1 il). Təqvim fərqi ilk olaraq dəqiq il/ay/gün kimi hesablanır.
 */

export interface Ymd {
  years: number;
  months: number;
  days: number;
}

export const ZERO: Ymd = { years: 0, months: 0, days: 0 };

export const DAY_MS = 86_400_000;

export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

export function todayUtc(): Date {
  const n = new Date();
  return utcDate(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

export function normalize(v: Ymd): Ymd {
  let { years, months, days } = v;
  months += Math.floor(days / 30);
  days = days % 30;
  years += Math.floor(months / 12);
  months = months % 12;
  return { years, months, days };
}

export function add(a: Ymd, b: Ymd): Ymd {
  return normalize({ years: a.years + b.years, months: a.months + b.months, days: a.days + b.days });
}

export const toDays = (v: Ymd) => v.years * 360 + v.months * 30 + v.days;
export const fromDays = (n: number): Ymd => normalize({ years: 0, months: 0, days: Math.max(0, Math.round(n)) });

/** İki tarix arasındakı təqvim fərqi (hər iki gün daxil olmaqla) */
export function diff(start: Date, end: Date): Ymd {
  if (end < start) return ZERO;
  const endInclusive = new Date(end.getTime() + DAY_MS);
  let years = endInclusive.getUTCFullYear() - start.getUTCFullYear();
  let months = endInclusive.getUTCMonth() - start.getUTCMonth();
  let days = endInclusive.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months -= 1;
    // əvvəlki ayın gün sayı
    days += new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return normalize({ years, months, days });
}

/** İki aralığın kəsişməsindəki təqvim günləri (hər iki uc daxil) */
export function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  return e < s ? 0 : Math.round((e - s) / DAY_MS) + 1;
}

export function addYearsUtc(d: Date, years: number): Date {
  return utcDate(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate());
}

export interface SeniorityConfig {
  /**
   * Hər iş ilində əmək stajına daxil edilən ödənişsiz məzuniyyət günlərinin həddi.
   * Bu həddi aşan günlər stajdan çıxılır. Müəssisənin hüquq şöbəsi ilə təsdiqlənməlidir.
   */
  unpaidLeaveAllowanceDaysPerYear: number;
}

export const DEFAULT_SENIORITY_CONFIG: SeniorityConfig = {
  unpaidLeaveAllowanceDaysPerYear: 14,
};

export interface ServicePeriod {
  start: Date;
  end: Date | null; // null = davam edir
}

export interface UnpaidPeriod {
  start: Date;
  end: Date;
}

export interface SeniorityResult {
  initial: Ymd;
  service: Ymd;
  deductedDays: number;
  total: Ymd;
  totalYears: number; // kəsr ilə (məzuniyyət pillələri üçün)
}

/**
 * Ümumi əmək stajı = işə qəbul tarixinə olan ilkin staj + müəssisədəki fəaliyyət − limitdən artıq ödənişsiz məzuniyyət.
 * Limit hər iş ili (işə qəbul ildönümündən başlayan 12 ay) üzrə ayrıca tətbiq olunur.
 */
export function computeSeniority(
  initial: Ymd,
  service: ServicePeriod[],
  unpaid: UnpaidPeriod[],
  asOf: Date = todayUtc(),
  config: SeniorityConfig = DEFAULT_SENIORITY_CONFIG,
): SeniorityResult {
  // Üst-üstə düşən müqavilələri (əsas + əvəzçilik) birləşdiririk ki, eyni gün iki dəfə sayılmasın
  const ranges = service
    .map((s) => ({ start: s.start, end: s.end && s.end < asOf ? s.end : asOf }))
    .filter((r) => r.start <= r.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: { start: Date; end: Date }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start.getTime() <= last.end.getTime() + DAY_MS) {
      if (r.end > last.end) last.end = r.end;
    } else merged.push({ ...r });
  }

  let serviceYmd = ZERO;
  let deducted = 0;
  for (const m of merged) {
    serviceYmd = add(serviceYmd, diff(m.start, m.end));
    for (let yearStart = m.start; yearStart <= m.end; yearStart = addYearsUtc(yearStart, 1)) {
      const yearEnd = new Date(Math.min(addYearsUtc(yearStart, 1).getTime() - DAY_MS, m.end.getTime()));
      const unpaidDays = unpaid.reduce((sum, u) => sum + overlapDays(yearStart, yearEnd, u.start, u.end), 0);
      deducted += Math.max(0, unpaidDays - config.unpaidLeaveAllowanceDaysPerYear);
    }
  }

  const initialN = normalize(initial);
  const total = fromDays(toDays(initialN) + toDays(serviceYmd) - deducted);
  return { initial: initialN, service: serviceYmd, deductedDays: deducted, total, totalYears: toDays(total) / 360 };
}

export function formatYmd(v: Ymd): string {
  return `${v.years} il ${v.months} ay ${v.days} gün`;
}
