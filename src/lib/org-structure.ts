import type { DepartmentChangeKind, DepartmentKind } from "@prisma/client";

/*
 * Struktur qaydaları — təmiz funksiyalar (server, worker, brauzer və testlər üçün; server-only YOX).
 */

/** Ağacın ən çox səviyyəsi (TZ: çevik iyerarxiya; şablonda vərəq üzrə 1–6) */
export const MAX_DEPT_LEVEL = 6;

const ORDINAL_SUFFIX: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu", 0: "cu" };
/** 1 → «1-ci», 3 → «3-cü», 6 → «6-cı» */
export const ordinal = (n: number) => `${n}-${ORDINAL_SUFFIX[n % 10] ?? "ci"}`;
export const levelLabel = (n: number) => `${ordinal(n)} səviyyə`;

export const DEPARTMENT_KIND_LABELS: Record<DepartmentKind, string> = {
  KURATOR_BLOKU: "Kurator bloku",
  DEPARTAMENT: "Departament",
  SOBE: "Şöbə",
  BOLME: "Bölmə",
  SEKTOR: "Sektor",
  MERKEZ: "Mərkəz",
  LABORATORIYA: "Laboratoriya",
  TEDQIQAT_QRUPU: "Tədqiqat qrupu",
  FAKULTE: "Fakültə",
  KAFEDRA: "Kafedra",
  XIDMET: "Xidmət",
  INSTITUT: "İnstitut",
  KOLLEC: "Kollec",
  BINA: "Bina",
  MUZEY: "Muzey",
  SURA: "Şura",
  DIGER: "Digər",
};

export const DEPARTMENT_KINDS = Object.keys(DEPARTMENT_KIND_LABELS) as DepartmentKind[];

export const CHANGE_KIND_LABELS: Record<DepartmentChangeKind, string> = {
  CREATE: "Yaradılma",
  RENAME: "Adın dəyişdirilməsi",
  MOVE: "Tabeliyin dəyişdirilməsi",
  CLOSE: "Bağlanma",
  MERGE: "Birləşmə",
};

/** Növ verilməyibsə köhnə bayraqlardan təxmin: fakültə / kafedra; qalanları — null (naməlum) */
export function effectiveKind(d: { kind: DepartmentKind | null; isFaculty: boolean; isChair: boolean }): DepartmentKind | null {
  return d.kind ?? (d.isFaculty ? "FAKULTE" : d.isChair ? "KAFEDRA" : null);
}

/**
 * isFaculty / isChair geri uyğunluq üçün kind ilə sinxron saxlanılır:
 * kind = FAKULTE → isFaculty; KAFEDRA → isChair; başqa növ → hər ikisi false. kind yoxdursa — bayraqlardan təyin olunur.
 */
export function syncKindFlags(v: { kind?: DepartmentKind | null; isFaculty?: boolean; isChair?: boolean }): { kind: DepartmentKind | null; isFaculty: boolean; isChair: boolean } {
  if (v.kind) return { kind: v.kind, isFaculty: v.kind === "FAKULTE", isChair: v.kind === "KAFEDRA" };
  const isFaculty = !!v.isFaculty;
  const isChair = !isFaculty && !!v.isChair;
  return { kind: isFaculty ? "FAKULTE" : isChair ? "KAFEDRA" : null, isFaculty, isChair };
}

/** Kod müqayisəsi rəqəmləri ədəd kimi: P1-F2 < P1-F10 */
const collator = new Intl.Collator("az", { numeric: true, sensitivity: "base" });

/** Eyni valideyn daxilində sıra: sortOrder (varsa) → kod */
export function compareDepartments(a: { sortOrder: number | null; code: string }, b: { sortOrder: number | null; code: string }): number {
  const sa = a.sortOrder ?? Number.POSITIVE_INFINITY;
  const sb = b.sortOrder ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa < sb ? -1 : 1;
  return collator.compare(a.code, b.code);
}

// ----------------------------------------------------------------------------
//  Tarixə görə struktur (TZ M01-01, DAT-01)
// ----------------------------------------------------------------------------

/** Dəyişiklikdə saxlanılan sahələr (before / after) */
export interface DeptStateFields {
  name?: string;
  parentId?: string | null;
  closedOn?: string | null; // YYYY-MM-DD
}

export interface DeptSnapshot {
  id: string;
  name: string;
  parentId: string | null;
  createdOn: Date;
  closedOn: Date | null;
  level: number;
}

export interface ChangeRecord {
  departmentId: string;
  kind: DepartmentChangeKind;
  effectiveDate: Date;
  before: DeptStateFields | null;
  after: DeptStateFields | null;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

function applyFields<T extends DeptSnapshot>(d: T, f: DeptStateFields | null) {
  if (!f) return;
  if (f.name !== undefined) d.name = f.name;
  if (f.parentId !== undefined) d.parentId = f.parentId;
  if (f.closedOn !== undefined) d.closedOn = parseDay(f.closedOn);
}

/**
 * Göstərilən günün strukturu: cari vəziyyətdən başlayır,
 *  1) həmin gündən SONRA qüvvəyə minmiş (tətbiq olunmuş) dəyişiklikləri yenidən köhnəyə qaytarır (before),
 *  2) həmin günədək qüvvəyə minməli, amma hələ tətbiq olunmamış planlaşdırılmış dəyişiklikləri irəli tətbiq edir (after) —
 *     gələcək tarixə baxış planlaşdırılmış sxemi göstərir,
 *  3) həmin gün mövcud olmayan bölmələri (yaradılmamış / bağlanmış) çıxarır, səviyyələri valideyn zəncirindən yenidən hesablayır.
 * Ləğv edilmiş dəyişikliklər nəzərə alınmır. Cari massiv dəyişdirilmir.
 */
export function structureAsOf<T extends DeptSnapshot>(current: readonly T[], changes: readonly ChangeRecord[], asOf: Date): T[] {
  const state = new Map(current.map((d) => [d.id, { ...d }]));
  const live = changes.filter((c) => !c.cancelledAt);
  const undo = live
    .filter((c) => c.appliedAt && c.effectiveDate > asOf)
    .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  for (const c of undo) {
    const d = state.get(c.departmentId);
    if (d) applyFields(d, c.before);
  }
  const redo = live
    .filter((c) => !c.appliedAt && c.effectiveDate <= asOf)
    .sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
  for (const c of redo) {
    const d = state.get(c.departmentId);
    if (d) applyDue(d, c);
  }
  const alive = new Map([...state].filter(([, d]) => d.createdOn <= asOf && (!d.closedOn || d.closedOn > asOf)));
  const levelOf = (id: string, seen = new Set<string>()): number => {
    const d = alive.get(id)!;
    if (!d.parentId || !alive.has(d.parentId) || seen.has(d.parentId)) return 1;
    seen.add(id);
    return levelOf(d.parentId, seen) + 1;
  };
  return [...alive.values()].map((d) => ({ ...d, parentId: d.parentId && alive.has(d.parentId) ? d.parentId : null, level: levelOf(d.id) }));
}

/** Planlaşdırılmış dəyişikliyin bölmə vəziyyətinə tətbiqi (CLOSE / MERGE — bağlanma tarixi = qüvvəyə minmə tarixi) */
function applyDue<T extends DeptSnapshot>(d: T, c: ChangeRecord) {
  if (c.kind === "CLOSE" || c.kind === "MERGE") d.closedOn = c.after?.closedOn ? parseDay(c.after.closedOn) : c.effectiveDate;
  else applyFields(d, c.after);
}

/** Bu günədək qüvvəyə minməli, hələ tətbiq olunmamış (və ləğv edilməmiş) dəyişikliklər — tətbiq ardıcıllığı ilə */
export function dueChanges<C extends Pick<ChangeRecord, "effectiveDate" | "appliedAt" | "cancelledAt" | "createdAt">>(changes: readonly C[], today: Date): C[] {
  return changes
    .filter((c) => !c.appliedAt && !c.cancelledAt && c.effectiveDate <= today)
    .sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
}

/** Dəyişiklik dərhal tətbiq olunur (bu gün və ya keçmiş) yoxsa planlaşdırılır (gələcək) */
export const isFutureDated = (effectiveDate: Date, today: Date) => effectiveDate.getTime() > today.getTime();

export const changeFields = (d: { name: string; parentId: string | null; closedOn: Date | null }): DeptStateFields => ({
  name: d.name,
  parentId: d.parentId,
  closedOn: d.closedOn ? isoDay(d.closedOn) : null,
});

// ----------------------------------------------------------------------------
//  Tabelik dəyişikliyi və bağlanma (TZ M01-03)
// ----------------------------------------------------------------------------

/**
 * Bölməni yeni valideynə köçürmək mümkündürmü: dairəvi tabelik qadağandır, alt ağac MAX_DEPT_LEVEL-i keçməməlidir.
 * subtreeDepth — bölmənin özü daxil alt ağacın dərinliyi (yarpaq = 1).
 */
export function moveError(opts: { id: string; newParentId: string | null; newParentLevel: number; subtreeIds: ReadonlySet<string>; subtreeDepth: number }): string | null {
  if (opts.newParentId && (opts.newParentId === opts.id || opts.subtreeIds.has(opts.newParentId))) return "Bölmə öz alt bölməsinə tabe edilə bilməz (dairəvi tabelik)";
  const newLevel = opts.newParentId ? opts.newParentLevel + 1 : 1;
  if (newLevel + opts.subtreeDepth - 1 > MAX_DEPT_LEVEL) return `Struktur ən çox ${MAX_DEPT_LEVEL} səviyyəli ola bilər — bu köçürmə ilə alt bölmələr ${newLevel + opts.subtreeDepth - 1}-ci səviyyəyə düşür`;
  return null;
}

export const levelError = (level: number) => (level > MAX_DEPT_LEVEL ? `Struktur ən çox ${MAX_DEPT_LEVEL} səviyyəli ola bilər` : level < 1 ? "Səviyyə yanlışdır" : null);

/** Bağlanmadan əvvəl göstərilən əlaqələr */
export interface CloseImpact {
  activeEmployments: number;
  openChildren: number;
  staffingUnits: number;
  /** Əsasnamə və vəzifə təlimatları (bu bölməyə aid) */
  documents: number;
  /** Bölməyə bağlı şöbə rəhbəri hesabları */
  headUsers: number;
}

/**
 * Bağlanma / birləşmə bloklanırmı: aktiv müqavilə (köçürmə tələb olunur) və bağlanmamış alt bölmə olmamalıdır.
 * Ştat, sənəd və rəhbər hesabları yalnız məlumat üçündür (tarixçə saxlanılır).
 */
export function closeBlockers(i: CloseImpact): string[] {
  const out: string[] = [];
  if (i.activeEmployments > 0) out.push(`${i.activeEmployments} aktiv müqavilə var — əvvəlcə əməkdaşları başqa bölməyə köçürün (kadr hərəkəti)`);
  if (i.openChildren > 0) out.push(`${i.openChildren} bağlanmamış alt bölmə var — əvvəlcə onları bağlayın və ya başqa bölməyə tabe edin`);
  return out;
}
