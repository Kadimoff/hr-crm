import "server-only";
import type { PositionClass, RegulationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export const POSITION_CLASS_LABELS: Record<PositionClass, string> = {
  // TZ §3 «Akademik və qeyri-akademik heyətin təsnifatı»
  A1: "A1 — Akademik tədris heyəti",
  A2: "A2 — Elmi tədqiqat heyəti",
  N1: "N1 — İnzibati idarəetmə",
  N2: "N2 — Peşəkar və inzibati dəstək",
  N3: "N3 — Tədris və tələbə xidmətləri",
  N4: "N4 — Texniki və rəqəmsal dəstək",
  N5: "N5 — Təsərrüfat və xidmət",
};

export interface CatalogRow {
  id: string;
  code: string;
  name: string;
  staffCategory: string;
  jobFamily: string | null;
  classCode: PositionClass | null;
  gradeCode: string | null;
  departments: number;
  employments: number;
  jd: { id: string; version: number; status: RegulationStatus } | null;
  pendingAcks: number;
  closed: boolean;
}

/** Vəzifə kataloqu (TZ M03-01): bir vəzifə — bir JobID, müxtəlif bölmələrdə ayrıca ştat mövqeləri ilə */
export async function getCatalog(): Promise<CatalogRow[]> {
  const today = new Date();
  const [positions, emp, depts, jds, acks] = await Promise.all([
    prisma.position.findMany({ orderBy: { name: "asc" } }),
    prisma.employment.groupBy({ by: ["positionId"], where: { status: { not: "TERMINATED" }, person: { deletedAt: null } }, _count: { _all: true } }),
    prisma.staffingUnit.groupBy({ by: ["positionId", "departmentId"] }),
    prisma.jobDescription.findMany({ orderBy: { version: "desc" }, select: { id: true, positionId: true, version: true, status: true, departmentId: true } }),
    prisma.jobDescriptionAck.findMany({ where: { acknowledgedAt: null, employment: { status: { not: "TERMINATED" } } }, select: { jobDescription: { select: { positionId: true } } } }),
  ]);
  const e = new Map(emp.map((x) => [x.positionId, x._count._all]));
  const dc = new Map<string, number>();
  for (const x of depts) dc.set(x.positionId, (dc.get(x.positionId) ?? 0) + 1);
  const pa = new Map<string, number>();
  for (const a of acks) pa.set(a.jobDescription.positionId, (pa.get(a.jobDescription.positionId) ?? 0) + 1);
  const jdOf = new Map<string, CatalogRow["jd"]>();
  for (const j of jds) {
    if (j.departmentId) continue;
    const cur = jdOf.get(j.positionId);
    if (!cur || (cur.status !== "TESDIQLENIB" && j.status === "TESDIQLENIB")) jdOf.set(j.positionId, { id: j.id, version: j.version, status: j.status });
  }
  const STAFF: Record<string, string> = { INZIBATI: "İnzibati", PROFESSOR_MUELLIM: "Professor-müəllim", TEDRIS_KOMEKCI: "Tədris-köməkçi", XIDMETEDICI: "Xidmətedici" };
  return positions.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    staffCategory: STAFF[p.staffCategory] ?? p.staffCategory,
    jobFamily: p.jobFamily,
    classCode: p.classCode,
    gradeCode: p.gradeCode,
    departments: dc.get(p.id) ?? 0,
    employments: e.get(p.id) ?? 0,
    jd: jdOf.get(p.id) ?? null,
    pendingAcks: pa.get(p.id) ?? 0,
    closed: !!p.validTo && p.validTo <= today,
  }));
}

export interface AckRow {
  id: string;
  personId: string;
  code: string;
  fullName: string;
  department: string;
  position: string;
  jdId: string;
  jdTitle: string;
  jdVersion: number;
  jdStatus: RegulationStatus;
  reason: string | null;
  assignedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  note: string | null;
}

/** Tanışlıq tapşırıqları; pending — yalnız tanış olmayanlar (aktiv müqavilələr) */
export async function getAcks(opts: { pending?: boolean; jobDescriptionId?: string; scope?: string[] | null; personId?: string } = {}): Promise<AckRow[]> {
  const rows = await prisma.jobDescriptionAck.findMany({
    where: {
      ...(opts.pending ? { acknowledgedAt: null, jobDescription: { status: "TESDIQLENIB" } } : {}),
      ...(opts.jobDescriptionId ? { jobDescriptionId: opts.jobDescriptionId } : {}),
      employment: {
        status: { not: "TERMINATED" },
        person: { deletedAt: null, ...(opts.personId ? { id: opts.personId } : {}) },
        ...(opts.scope ? { departmentId: { in: opts.scope } } : {}),
      },
    },
    orderBy: [{ assignedAt: "desc" }],
    include: {
      jobDescription: { select: { id: true, title: true, version: true, status: true } },
      acknowledgedBy: { select: { fullName: true } },
      employment: { select: { person: { select: { id: true, code: true, fullName: true } }, department: { select: { name: true } }, position: { select: { name: true } } } },
    },
  });
  return rows.map((a) => ({
    id: a.id,
    personId: a.employment.person.id,
    code: a.employment.person.code,
    fullName: a.employment.person.fullName,
    department: a.employment.department.name,
    position: a.employment.position.name,
    jdId: a.jobDescription.id,
    jdTitle: a.jobDescription.title,
    jdVersion: a.jobDescription.version,
    jdStatus: a.jobDescription.status,
    reason: a.reason,
    assignedAt: a.assignedAt,
    acknowledgedAt: a.acknowledgedAt,
    acknowledgedBy: a.acknowledgedBy?.fullName ?? null,
    note: a.note,
  }));
}
