import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/*
 * Intl-in "az-AZ" lokalı Node və brauzerlərdə fərqli nəticə verir (hidrasiya uyğunsuzluğu),
 * ona görə Azərbaycan formatı əl ilə qurulur: 4 500,00 ₼
 */
const NBSP = "\u00A0";

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function formatNumber(n: number, fractionDigits = 0): string {
  const sign = n < 0 ? "−" : "";
  const [int, frac] = Math.abs(n).toFixed(fractionDigits).split(".");
  return sign + groupThousands(int!) + (frac ? `,${frac}` : "");
}

export const formatAzn = (n: number) => `${formatNumber(n, 2)}${NBSP}₼`;

/** ISO tarix → DD.MM.YYYY (UTC) */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase("az"))
    .join("");
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Baku",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Tarix və vaxt Bakı vaxtı ilə: DD.MM.YYYY HH:mm */
export function formatDateTime(d: Date | string): string {
  const parts = Object.fromEntries(DATE_TIME.formatToParts(new Date(d)).map((p) => [p.type, p.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}
