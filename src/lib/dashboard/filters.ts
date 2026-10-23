/**
 * İdarə paneli üçün cross-filter məntiqi — saf funksiyalar (client və server tərəfində eyni işləyir).
 * Yeni qrafik əlavə etmək üçün: sətirləri `applyFilters(rows, filters, "<öz açarı>")` ilə süzün,
 * seçilmiş elementi `filters[<açar>]` ilə vurğulayın, klikdə `toggle(<açar>, dəyər)` çağırın.
 */

export const FILTER_KEYS = ["department", "category", "year", "gender", "degree"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

export const FILTER_LABELS: Record<FilterKey, string> = {
  department: "Struktur",
  category: "Kateqoriya",
  year: "İşə qəbul ili",
  gender: "Cins",
  degree: "Elmi dərəcə",
};

export const GENDERS = ["Kişi", "Qadın"] as const;
export const CATEGORIES = ["İnzibati", "Professor-müəllim", "Tədris-köməkçi", "Xidmətedici"] as const;
export const DEGREES = ["Elmlər doktoru", "Fəlsəfə doktoru", "Elmi dərəcəsiz"] as const;
export const ACADEMIC_CATEGORY = "Professor-müəllim";

export interface DeptRef {
  id: string;
  name: string;
  level: number;
}

/** Bir aktiv əmək müqaviləsi — bütün qrafiklərin ortaq mənbəyi */
export interface DashboardRow {
  employmentId: string;
  personId: string;
  code: string;
  fullName: string;
  gender: (typeof GENDERS)[number];
  category: string;
  position: string;
  degree: (typeof DEGREES)[number];
  /** Kökdən (1-ci səviyyə) müqavilənin bölməsinədək */
  deptPath: DeptRef[];
  hireDate: string; // ISO
  hireYear: number;
  unitShare: number;
  gross: number;
  net: number;
  employerCost: number;
  /** Bu gün məzuniyyətdə və ya işdə iştirak etmir */
  onLeave: boolean;
}

/** Ştat vahidləri (doluluğun məxrəci) — yalnız struktur və kateqoriya filtrləri tətbiq olunur */
export interface StaffingRow {
  deptPath: string[];
  category: string;
  units: number;
}

export interface DepartmentOption extends DeptRef {
  parentId: string | null;
}

export interface DashboardDataset {
  rows: DashboardRow[];
  staffing: StaffingRow[];
  departments: DepartmentOption[];
}

const MATCHERS: Record<FilterKey, (r: DashboardRow, v: string) => boolean> = {
  // Bölmə seçiləndə bütün alt bölmələr daxildir
  department: (r, v) => r.deptPath.some((d) => d.id === v),
  category: (r, v) => r.category === v,
  year: (r, v) => String(r.hireYear) === v,
  gender: (r, v) => r.gender === v,
  degree: (r, v) => r.degree === v,
};

/**
 * Bütün aktiv filtrləri tətbiq edir. `excludeKey` — qrafikin öz ölçüsü: o filtr məlumata tətbiq olunmur,
 * qrafik onu yalnız vurğulama (seçilən tam, digərləri solğun) kimi göstərir.
 */
export function applyFilters(rows: DashboardRow[], filters: Filters, excludeKey?: FilterKey): DashboardRow[] {
  const active = FILTER_KEYS.filter((k) => k !== excludeKey && filters[k]);
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every((k) => MATCHERS[k](r, filters[k]!)));
}

export function applyStaffingFilters(staffing: StaffingRow[], filters: Filters): StaffingRow[] {
  return staffing.filter((s) => (!filters.department || s.deptPath.includes(filters.department)) && (!filters.category || s.category === filters.category));
}

export function parseFilters(params: URLSearchParams | Record<string, string | string[] | undefined>): Filters {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  };
  const out: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = get(k);
    if (v) out[k] = v;
  }
  return out;
}

export function filtersToQuery(filters: Filters): string {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) if (filters[k]) q.set(k, filters[k]!);
  return q.toString();
}

export const hasFilters = (f: Filters) => FILTER_KEYS.some((k) => !!f[k]);

// ----------------------------------------------------------------------------
//  Aqreqasiyalar
// ----------------------------------------------------------------------------

export interface Kpis {
  headcount: number;
  filledUnits: number;
  totalUnits: number;
  fillRate: number | null;
  academicRatio: number | null;
  payrollGross: number;
  payrollNet: number;
  payrollEmployerCost: number;
  activeLeaves: number;
}

export function computeKpis(rows: DashboardRow[], staffing: StaffingRow[]): Kpis {
  const totalUnits = staffing.reduce((s, x) => s + x.units, 0);
  const filledUnits = rows.reduce((s, r) => s + r.unitShare, 0);
  return {
    headcount: new Set(rows.map((r) => r.personId)).size,
    filledUnits,
    totalUnits,
    fillRate: totalUnits > 0 ? filledUnits / totalUnits : null,
    academicRatio: rows.length ? rows.filter((r) => r.category === ACADEMIC_CATEGORY).length / rows.length : null,
    payrollGross: rows.reduce((s, r) => s + r.gross, 0),
    payrollNet: rows.reduce((s, r) => s + r.net, 0),
    payrollEmployerCost: rows.reduce((s, r) => s + r.employerCost, 0),
    activeLeaves: new Set(rows.filter((r) => r.onLeave).map((r) => r.personId)).size,
  };
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
  gross: number;
  /** Ümumi saydan pay, 0..1 */
  share: number;
  /** Brutto ƏH fondundan pay, 0..1 */
  grossShare: number;
}

/**
 * Sətirləri qruplaşdırır. Say — unikal şəxslər (iki müqaviləsi olan bir dəfə sayılır), brutto — bütün müqavilələr.
 * `keys` verilibsə, sayı 0 olanlar da qaytarılır və sıra saxlanılır.
 */
export function bucketize(rows: DashboardRow[], keyOf: (r: DashboardRow) => string | null, keys?: readonly string[], labelOf: (k: string) => string = (k) => k): Bucket[] {
  const map = new Map<string, { people: Set<string>; gross: number }>();
  for (const k of keys ?? []) map.set(k, { people: new Set(), gross: 0 });
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null) continue;
    const b = map.get(k) ?? { people: new Set<string>(), gross: 0 };
    b.people.add(r.personId);
    b.gross += r.gross;
    map.set(k, b);
  }
  const total = new Set(rows.map((r) => r.personId)).size;
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  return [...map.entries()].map(([key, b]) => ({
    key,
    label: labelOf(key),
    count: b.people.size,
    gross: b.gross,
    share: total ? b.people.size / total : 0,
    grossShare: totalGross ? b.gross / totalGross : 0,
  }));
}
