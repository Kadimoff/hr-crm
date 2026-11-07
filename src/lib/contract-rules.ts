/* Müqavilə sonu bildiriş pillələri (TZ M05-03) — təmiz funksiyalar */

export const DEFAULT_THRESHOLDS = [90, 60, 30];

/** «?d=90,60,30» → [90, 60, 30] (1–365, azalan; yanlışdırsa — defolt) */
export function parseThresholds(v: string | undefined): number[] {
  if (!v) return DEFAULT_THRESHOLDS;
  const n = [...new Set(v.split(/[,\s]+/).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 365))].sort((a, b) => b - a).slice(0, 5);
  return n.length ? n : DEFAULT_THRESHOLDS;
}

/** Qalan gün → bildiriş pilləsi: keçib (<0), ən kiçik həddən başlayaraq; həddən kənar — null */
export function bucketOf(daysLeft: number, thresholds: number[]): number | "overdue" | null {
  if (daysLeft < 0) return "overdue";
  const asc = [...thresholds].sort((a, b) => a - b);
  return asc.find((t) => daysLeft <= t) ?? null;
}

