/**
 * Maaş məxfiliyi — saf qaydalar (client, server, worker və testlərdə eyni işləyir; DB yoxdur).
 *
 * Owner qərarı: «Eyçarlar biri birilərinin maaşlarını əsla görə bilməz».
 *  - Məxfi şəxs: maaşı məxfi bölmədə (Department.salaryRestricted, alt bölmələr daxil) müqaviləsi olan / olmuş,
 *    əl ilə işarələnmiş (Person.salaryRestricted) və ya istifadəçi hesabına bağlanmış (User.personId) şəxs.
 *  - Görür və dəyişir: ROOT və root-un «məxfi maaşları görə bilər» verdiyi HR hesabı (imtiyazlı).
 *  - Öz maaşını: hesab bağlı olduğu şəxsin maaşını görür, amma dəyişə bilmir.
 *  - Qalan HR-lar və şöbə rəhbərləri məxfi şəxsin maaşını görmür: server heç vaxt göndərmir (RSC, API, Excel, çap).
 */
import type { UserRole } from "@prisma/client";

export interface SalaryViewer {
  role: UserRole;
  /** Hesabın bağlı olduğu əməkdaş */
  personId: string | null;
  canViewRestrictedSalaries: boolean;
}

/** UI-da maaşın yerinə */
export const SALARY_HIDDEN_LABEL = "Məxfi";
export const SALARY_HIDDEN_HINT = "Bu əməkdaşın maaşı məxfidir — yalnız root və səlahiyyətli hesab görür";
export const SALARY_LOCKED_MESSAGE = "Bu əməkdaşın okladı məxfidir — onu yalnız root və ya səlahiyyətli hesab dəyişə bilər";
export const SALARY_SELF_MESSAGE = "Öz maaş və vəzifə məlumatlarınızı dəyişə bilməzsiniz — root və ya səlahiyyətli hesaba müraciət edin";
export const SALARY_TRANSFER_MESSAGE = "Maaşı məxfi olan əməkdaşı maaşı məxfi olmayan bölməyə yalnız root və ya səlahiyyətli hesab köçürə bilər";
export const SALARY_EXCLUDED_NOTE = "Məxfi maaşlar cəmlərə daxil deyil";

/** Məxfi maaşları görən və dəyişən hesab: root və root-un icazə verdiyi kadr əməkdaşı (şöbə rəhbəri heç vaxt) */
export const isSalaryPrivileged = (u: SalaryViewer): boolean => u.role === "ROOT" || (u.role === "HR" && u.canViewRestrictedSalaries);

const restrictedOf = (personId: string, restricted: ReadonlySet<string> | boolean) => (typeof restricted === "boolean" ? restricted : restricted.has(personId));

/** Görə bilər: imtiyazlı, şəxs məxfi deyil və ya öz maaşıdır */
export function canSeeSalary(u: SalaryViewer, personId: string, restricted: ReadonlySet<string> | boolean): boolean {
  if (isSalaryPrivileged(u)) return true;
  if (u.personId && u.personId === personId) return true;
  return !restrictedOf(personId, restricted);
}

/** Dəyişə bilər: imtiyazlı; qalanları yalnız məxfi olmayan və özünə aid olmayan şəxsin maaşını */
export function canEditSalary(u: SalaryViewer, personId: string, restricted: ReadonlySet<string> | boolean): boolean {
  if (isSalaryPrivileged(u)) return true;
  if (u.personId && u.personId === personId) return false;
  return !restrictedOf(personId, restricted);
}

/** İstifadəçidən gizlədilən şəxslər: imtiyazlı üçün boş; qalanları üçün məxfilər − özü */
export function hiddenFor(u: SalaryViewer, restricted: ReadonlySet<string>): Set<string> {
  if (isSalaryPrivileged(u)) return new Set();
  const out = new Set(restricted);
  if (u.personId) out.delete(u.personId);
  return out;
}

/** Maaşını dəyişə bilmədiyi şəxslər: imtiyazlı üçün boş; qalanları üçün məxfilər + özü */
export function lockedFor(u: SalaryViewer, restricted: ReadonlySet<string>): Set<string> {
  if (isSalaryPrivileged(u)) return new Set();
  const out = new Set(restricted);
  if (u.personId) out.add(u.personId);
  return out;
}

/**
 * Formadan gələn oklad (kilidli şəxs üçün): sahə formada göndərilmir (disabled) — boş gəlməsi mövcud okladı SİLMİR,
 * mövcud dəyər server tərəfdə qoyulur. Dəyər göndərilibsə (əl ilə POST) — rədd: «eynidirsə qəbul et» olsaydı,
 * cavab maaşı təxmin etməyə imkan verərdi (oracle).
 */
export function lockedSalaryInput(submitted: unknown, current: number): { ok: true; value: number } | { ok: false; error: string } {
  const blank = submitted === undefined || submitted === null || (typeof submitted === "string" && submitted.trim() === "");
  return blank ? { ok: true, value: current } : { ok: false, error: SALARY_LOCKED_MESSAGE };
}

/** Kadr hərəkətinin əvvəl→sonra oklad sahələrini gizlədir; oklad dəyişibsə «məxfi» işarəsi qalır */
export function maskMovementSalary<T extends { fromSalary: unknown; toSalary: unknown }>(m: T, hide: boolean): Omit<T, "fromSalary" | "toSalary"> & { fromSalary: T["fromSalary"] | null; toSalary: T["toSalary"] | null; salaryMasked: boolean } {
  if (!hide) return { ...m, salaryMasked: false };
  return { ...m, fromSalary: null, toSalary: null, salaryMasked: m.toSalary !== null && m.toSalary !== undefined };
}

/**
 * İdxal sətrinin maaş sahələrini gizlədir (önizləmə / xəta cədvəli). Sahə dəyəri silinir, sahəyə aid xəta mətnləri
 * (ştat diapazonu kimi rəqəmlər ola bilər) ümumi izahla əvəz olunur.
 */
export function maskStagingRow<R extends { data: Record<string, string | null | undefined>; errors: { field: string; message: string }[] }>(row: R, fields: readonly string[]): R & { masked: string[] } {
  const data = { ...row.data };
  const masked: string[] = [];
  for (const f of fields) {
    if (f in data) {
      data[f] = "";
      masked.push(f);
    }
  }
  const errors = row.errors.map((e) => (fields.includes(e.field) ? { ...e, message: `${SALARY_HIDDEN_LABEL}: ${SALARY_HIDDEN_HINT}` } : e));
  return { ...row, data, errors, masked };
}

/** Maaş sahələri olan idxal vərəqləri */
export const STAGING_SALARY_FIELDS: Partial<Record<string, readonly string[]>> = {
  employments: ["baseSalary"],
  staffing: ["minSalary", "maxSalary"],
};
