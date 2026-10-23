import { z } from "zod";

/**
 * Excel hüceyrələrinin mətnə çevrilmiş dəyərləri üçün baza primitivləri.
 * Parser bütün dəyərləri string kimi verir; tarixlər DD.MM.YYYY formatında olmalıdır.
 */

/** Zod issue `params`-ı ilə ötürülür — validator bu xətanı "semantic" səviyyəsinə aid edir */
export const SEMANTIC = { tier: "semantic" } as const;

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

const EXCEL_SERIAL_RE = /^\d{5}$/;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * "DD.MM.YYYY" → UTC gecə yarısı Date. Yanlış təqvim tarixlərini (31.02) rədd edir.
 * Tarix formatı tətbiq olunmamış hüceyrələrdə Excel tarixi seriya nömrəsi kimi gəlir (məs. 45658 = 01.01.2025) —
 * 5 rəqəmli tam ədədlər (10000 = 18.05.1927 … 73050 = 31.12.2099) həmin qayda ilə çevrilir.
 * "2005" kimi 4 rəqəmli il və ya "2025-01-01" kimi mətn formatları rədd edilir.
 */
export function parseAzDate(value: string): Date | null {
  const v = value.trim();
  if (EXCEL_SERIAL_RE.test(v)) {
    const serial = Number(v);
    return serial >= 10000 && serial <= 73050 ? new Date(EXCEL_EPOCH + serial * 86_400_000) : null;
  }
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = Number(dd);
  const mo = Number(mm);
  const y = Number(yyyy);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function formatAzDate(date: Date | null | undefined): string {
  if (!date) return "";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Məcburi mətn */
export const reqText = (label: string) =>
  z.preprocess(blankToUndefined, z.string({ required_error: `${label} boş ola bilməz` }).trim().min(1, `${label} boş ola bilməz`));

/** Könüllü mətn */
export const optText = z.preprocess(blankToUndefined, z.string().trim().optional());

/** Məcburi tarix (DD.MM.YYYY) */
export const reqDate = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ required_error: `${label} boş ola bilməz` })
      .transform((v, ctx) => {
        const d = parseAzDate(v);
        if (!d) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: tarix DD.MM.YYYY formatında olmalıdır` });
          return z.NEVER;
        }
        return d;
      }),
  );

/** Könüllü tarix (DD.MM.YYYY) */
export const optDate = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((v, ctx) => {
        const d = parseAzDate(v);
        if (!d) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: tarix DD.MM.YYYY formatında olmalıdır` });
          return z.NEVER;
        }
        return d;
      })
      .optional(),
  );

/** "Daxil olduğu il" kimi sahələr: DD.MM.YYYY və ya yalnız il (YYYY → 01.01.YYYY) */
export const optYearOrDate = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((v, ctx) => {
        const t = v.trim();
        if (/^(19|20)\d{2}$/.test(t)) return new Date(Date.UTC(Number(t), 0, 1));
        const d = parseAzDate(t);
        if (!d) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: DD.MM.YYYY formatında və ya il (YYYY) kimi yazılmalıdır` });
          return z.NEVER;
        }
        return d;
      })
      .optional(),
  );

/** Rəqəm — vergüllü onluq ayırıcını da qəbul edir ("1 250,50") */
const toNumber = (v: unknown) => {
  if (typeof v !== "string") return v;
  const s = v.replace(/\s/g, "").replace(",", ".");
  return s === "" ? undefined : Number(s);
};

export const reqNumber = (label: string, opts: { min?: number; max?: number; int?: boolean } = {}) => {
  let n = z.number({ required_error: `${label} boş ola bilməz`, invalid_type_error: `${label} rəqəm olmalıdır` });
  if (opts.int) n = n.int(`${label} tam ədəd olmalıdır`);
  if (opts.min !== undefined) n = n.min(opts.min, `${label} ≥ ${opts.min} olmalıdır`);
  if (opts.max !== undefined) n = n.max(opts.max, `${label} ≤ ${opts.max} olmalıdır`);
  return z.preprocess(toNumber, n.refine((x) => Number.isFinite(x), `${label} rəqəm olmalıdır`));
};

export const optNumber = (label: string, opts: { min?: number; max?: number; int?: boolean } = {}) => {
  let n = z.number({ invalid_type_error: `${label} rəqəm olmalıdır` });
  if (opts.int) n = n.int(`${label} tam ədəd olmalıdır`);
  if (opts.min !== undefined) n = n.min(opts.min, `${label} ≥ ${opts.min} olmalıdır`);
  if (opts.max !== undefined) n = n.max(opts.max, `${label} ≤ ${opts.max} olmalıdır`);
  return z.preprocess(toNumber, n.refine((x) => Number.isFinite(x), `${label} rəqəm olmalıdır`).optional());
};

const TRUE_WORDS = new Set(["bəli", "beli", "hə", "he", "1", "true", "x", "+", "var", "yes"]);
const FALSE_WORDS = new Set(["xeyr", "yox", "0", "false", "-", "yoxdur", "no"]);

/** Bəli/Xeyr bayrağı; boş = false */
export const flag = (label: string) =>
  z.preprocess(blankToUndefined, z.string().optional()).transform((v, ctx) => {
    if (v === undefined) return false;
    const s = v.trim().toLocaleLowerCase("az");
    if (TRUE_WORDS.has(s)) return true;
    if (FALSE_WORDS.has(s)) return false;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: "Bəli" və ya "Xeyr" olmalıdır` });
    return z.NEVER;
  });

/** Mətn → enum xəritələməsi (registr və diakritikadan asılı olmayaraq) */
export function enumFrom<T extends string>(label: string, map: Record<string, T>): z.ZodType<T, z.ZodTypeDef, unknown>;
export function enumFrom<T extends string>(label: string, map: Record<string, T>, required: false): z.ZodType<T | undefined, z.ZodTypeDef, unknown>;
export function enumFrom<T extends string>(label: string, map: Record<string, T>, required = true): z.ZodType<T | undefined, z.ZodTypeDef, unknown> {
  const normalized = new Map(Object.entries(map).map(([k, v]) => [normalizeKey(k), v]));
  const allowed = Object.keys(map).join(", ");
  const base = z.preprocess(blankToUndefined, required ? z.string({ required_error: `${label} boş ola bilməz` }) : z.string().optional());
  return base.transform((v, ctx): T | undefined => {
    if (v === undefined) return undefined;
    const hit = normalized.get(normalizeKey(v));
    if (!hit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: "${v}" tanınmır. İcazəli: ${allowed}` });
      return z.NEVER;
    }
    return hit;
  });
}

export function normalizeKey(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase("az")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** FİN kod: dəqiq 7 simvol, latın hərfləri və rəqəmlər (böyük hərflə saxlanır) */
export const finCode = z.preprocess(
  blankToUndefined,
  z
    .string({ required_error: "FİN kod boş ola bilməz" })
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v.length === 7, { message: "FİN kod dəqiq 7 simvol olmalıdır", params: SEMANTIC })
    .refine((v) => /^[A-Z0-9]*$/.test(v), { message: "FİN kod yalnız latın hərfləri və rəqəmlərdən ibarət olmalıdır", params: SEMANTIC }),
);

export const optEmail = z.preprocess(blankToUndefined, z.string().trim().email("E-poçt ünvanı yanlışdır").optional());

/** Kod sahəsi (şöbə, vəzifə, əməkdaş) — boşluqsuz */
export const code = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ required_error: `${label} boş ola bilməz` })
      .min(1, `${label} boş ola bilməz`)
      .regex(/^\S+$/, `${label} boşluq ehtiva edə bilməz`),
  );

/** İl/ay/gün staj üçlüyü */
export const seniorityPart = (label: string, max: number) => optNumber(label, { min: 0, max, int: true }).transform((v) => v ?? 0);

/** a + 1 il − 1 gün */
export function fullYearEnd(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate() - 1));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}
