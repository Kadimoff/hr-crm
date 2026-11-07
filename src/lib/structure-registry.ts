import "server-only";
import type { DepartmentChangeKind, DepartmentKind, RegulationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { compareDepartments, effectiveKind, type DeptStateFields } from "@/lib/org-structure";
import { reviewState } from "@/lib/regulations";

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

export interface RegistryDept {
  id: string;
  code: string;
  name: string;
  level: number;
  parentId: string | null;
  path: string[];
  kind: DepartmentKind | null;
  sortOrder: number | null;
  isExternal: boolean;
  isGroup: boolean;
  headPositionTitle: string | null;
  campus: string | null;
  budgetCenter: string | null;
  createdOn: Date;
  closedOn: Date | null;
  closed: boolean;
  activeEmployments: number;
  charter: { id: string; version: number; status: RegulationStatus; nextReviewOn: Date | null } | null;
  planned: number;
}

/** Bölmələr ağac sırası ilə (valideyn → uşaqlar, sortOrder → kod) — reyestr və seçim siyahıları üçün */
export async function getDepartmentRegistry(): Promise<RegistryDept[]> {
  const today = todayUtc();
  const [deps, counts, charters, planned] = await Promise.all([
    prisma.department.findMany(),
    prisma.employment.groupBy({ by: ["departmentId"], where: { status: { not: "TERMINATED" }, person: { deletedAt: null } }, _count: { _all: true } }),
    prisma.departmentCharter.findMany({ where: { status: { in: ["TESDIQLENIB", "QARALAMA", "HUQUQI_REYDE"] } }, orderBy: { version: "desc" }, select: { id: true, departmentId: true, version: true, status: true, nextReviewOn: true } }),
    prisma.departmentChange.groupBy({ by: ["departmentId"], where: { appliedAt: null, cancelledAt: null }, _count: { _all: true } }),
  ]);
  const cnt = new Map(counts.map((c) => [c.departmentId, c._count._all]));
  const pl = new Map(planned.map((c) => [c.departmentId, c._count._all]));
  // Qüvvədə olan (təsdiqlənmiş) əsasnamə; yoxdursa — açıq qaralama
  const ch = new Map<string, RegistryDept["charter"]>();
  for (const c of charters) {
    const cur = ch.get(c.departmentId);
    if (!cur || (cur.status !== "TESDIQLENIB" && c.status === "TESDIQLENIB")) ch.set(c.departmentId, { id: c.id, version: c.version, status: c.status, nextReviewOn: c.nextReviewOn });
  }
  const byParent = new Map<string | null, typeof deps>();
  const ids = new Set(deps.map((d) => d.id));
  for (const d of deps) {
    const p = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), d]);
  }
  const out: RegistryDept[] = [];
  const walk = (parentId: string | null, path: string[]) => {
    for (const d of [...(byParent.get(parentId) ?? [])].sort(compareDepartments)) {
      out.push({
        id: d.id,
        code: d.code,
        name: d.name,
        level: d.level,
        parentId: d.parentId,
        path,
        kind: effectiveKind(d),
        sortOrder: d.sortOrder,
        isExternal: d.isExternal,
        isGroup: d.isGroup,
        headPositionTitle: d.headPositionTitle,
        campus: d.campus,
        budgetCenter: d.budgetCenter,
        createdOn: d.createdOn,
        closedOn: d.closedOn,
        closed: !!d.closedOn && d.closedOn <= today,
        activeEmployments: cnt.get(d.id) ?? 0,
        charter: ch.get(d.id) ?? null,
        planned: pl.get(d.id) ?? 0,
      });
      walk(d.id, [...path, d.name]);
    }
  };
  walk(null, []);
  return out;
}

export interface ChangeRow {
  id: string;
  departmentId: string;
  department: string;
  code: string;
  kind: DepartmentChangeKind;
  effectiveDate: Date;
  orderNumber: string | null;
  orderDate: Date | null;
  before: DeptStateFields | null;
  after: DeptStateFields | null;
  target: string | null;
  note: string | null;
  source: string;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  by: string | null;
  /** Ad / tabelik dəyişikliyi mətnlə (valideyn id-ləri adlara çevrilib) */
  text: string;
  state: "planned" | "applied" | "cancelled" | "waiting";
}

export async function getDepartmentChanges(opts: { departmentId?: string; state?: string } = {}): Promise<ChangeRow[]> {
  const today = todayUtc();
  const [rows, deps] = await Promise.all([
    prisma.departmentChange.findMany({
      where: {
        ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
        ...(opts.state === "planned" ? { appliedAt: null, cancelledAt: null } : opts.state === "applied" ? { appliedAt: { not: null } } : {}),
      },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: { department: { select: { name: true, code: true } }, createdBy: { select: { fullName: true } } },
    }),
    prisma.department.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(deps.map((d) => [d.id, d.name]));
  const parentName = (id: string | null | undefined) => (id ? (name.get(id) ?? id) : "1-ci səviyyə (kök)");
  return rows.map((c) => {
    const before = (c.before ?? null) as DeptStateFields | null;
    const after = (c.after ?? null) as DeptStateFields | null;
    let text = "";
    switch (c.kind) {
      case "CREATE":
        text = `Yaradıldı: ${after?.name ?? c.department.name}`;
        break;
      case "RENAME":
        text = `«${before?.name ?? "?"}» → «${after?.name ?? "?"}»`;
        break;
      case "MOVE":
        text = `${parentName(before?.parentId)} → ${parentName(after?.parentId)}`;
        break;
      case "CLOSE":
        text = `Bağlanır: ${after?.closedOn ?? ""}`;
        break;
      case "MERGE":
        text = `${c.department.name} → ${c.targetDepartmentId ? parentName(c.targetDepartmentId) : "?"} ilə birləşir`;
        break;
    }
    const state: ChangeRow["state"] = c.cancelledAt ? "cancelled" : c.appliedAt ? "applied" : c.effectiveDate <= today ? "waiting" : "planned";
    return {
      id: c.id,
      departmentId: c.departmentId,
      department: c.department.name,
      code: c.department.code,
      kind: c.kind,
      effectiveDate: c.effectiveDate,
      orderNumber: c.orderNumber,
      orderDate: c.orderDate,
      before,
      after,
      target: c.targetDepartmentId ? (name.get(c.targetDepartmentId) ?? null) : null,
      note: c.note,
      source: c.source,
      appliedAt: c.appliedAt,
      cancelledAt: c.cancelledAt,
      createdAt: c.createdAt,
      by: c.createdBy?.fullName ?? (c.source === "IMPORT" ? "idxal" : null),
      text,
      state,
    };
  });
}

export interface CharterRegistryRow {
  id: string;
  departmentId: string;
  department: string;
  code: string;
  version: number;
  status: RegulationStatus;
  title: string;
  approvedOn: Date | null;
  effectiveFrom: Date | null;
  nextReviewOn: Date | null;
  review: "overdue" | "soon" | null;
  hasFile: boolean;
}

/** Əsasnamələr reyestri: bütün versiyalar (son versiyalar əvvəl) + baxış tarixi gecikənlər */
export async function getCharterRegistry(opts: { status?: string } = {}): Promise<CharterRegistryRow[]> {
  const today = todayUtc();
  const rows = await prisma.departmentCharter.findMany({
    where: opts.status && ["QARALAMA", "HUQUQI_REYDE", "TESDIQLENIB", "QUVVEDEN_DUSUB"].includes(opts.status) ? { status: opts.status as RegulationStatus } : {},
    orderBy: [{ department: { name: "asc" } }, { version: "desc" }],
    include: { department: { select: { name: true, code: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    departmentId: c.departmentId,
    department: c.department.name,
    code: c.department.code,
    version: c.version,
    status: c.status,
    title: c.title,
    approvedOn: c.approvedOn,
    effectiveFrom: c.effectiveFrom,
    nextReviewOn: c.nextReviewOn,
    review: c.status === "TESDIQLENIB" ? reviewState(c.nextReviewOn, today) : null,
    hasFile: !!c.fileStoragePath,
  }));
}
