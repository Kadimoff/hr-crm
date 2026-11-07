/*
 * «Məlum deyil» dəyərləri (TZ DAT-02): miqrasiyada mənbədə olmayan məcburi sahələr uydurulmur — null saxlanılır.
 * Boş (null) ≠ sıfır: maaşı məlum olmayan müqavilə ƏH fonduna 0 kimi daxil edilmir, ayrıca sayılır.
 * Təmiz modul (server, worker, brauzer, testlər).
 */

export const UNKNOWN_LABEL = "Məlum deyil";
export const SALARY_UNKNOWN_NOTE = "Maaşı məlum olmayan müqavilələr";

/** «Məlumat tamlığı» yoxlanılan sahələr — HR doldurmalıdır */
export const COMPLETENESS_FIELDS = {
  hireDate: "İşə qəbul tarixi",
  baseSalary: "Oklad",
  schedule: "İş qrafiki",
  paymentForm: "Ödəniş forması",
  idDoc: "Şəxsiyyət vəsiqəsi",
  seniority: "Staj (işə qəbul tarixi və açılış stajı yoxdur)",
  openingUnverified: "Açılış stajı yoxlanılmayıb",
} as const;

export type CompletenessField = keyof typeof COMPLETENESS_FIELDS;
export const COMPLETENESS_KEYS = Object.keys(COMPLETENESS_FIELDS) as CompletenessField[];

export interface CompletenessInput {
  idDocType: string | null;
  idDocNumber: string | null;
  openingSeniorityYears: number | null;
  openingSeniorityVerifiedAt: Date | null;
  employments: { hireDate: Date | null; baseSalary: unknown; schedule: string | null; paymentForm: string | null }[];
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** Şəxs üzrə çatışmayan sahələr (yalnız aktiv müqavilələr nəzərə alınır — çağıran süzür) */
export function missingFields(p: CompletenessInput): CompletenessField[] {
  const out: CompletenessField[] = [];
  const e = p.employments;
  if (e.some((x) => !x.hireDate)) out.push("hireDate");
  if (e.some((x) => x.baseSalary === null || x.baseSalary === undefined)) out.push("baseSalary");
  if (e.some((x) => blank(x.schedule))) out.push("schedule");
  if (e.some((x) => blank(x.paymentForm))) out.push("paymentForm");
  if (blank(p.idDocType) || blank(p.idDocNumber)) out.push("idDoc");
  const anyHire = e.some((x) => !!x.hireDate);
  if (!anyHire && p.openingSeniorityYears === null) out.push("seniority");
  if (!anyHire && p.openingSeniorityYears !== null && !p.openingSeniorityVerifiedAt) out.push("openingUnverified");
  return out;
}
