import "server-only";
import { computePayroll } from "@/lib/calc/payroll";
import { todayUtc } from "@/lib/calc/seniority";
import { prisma } from "@/lib/db";
import { STAFF_CATEGORY_LABELS } from "@/lib/queries";
import type { DashboardDataset, DashboardRow, DeptRef, StaffingRow } from "./filters";

/**
 * İdarə paneli üçün verilənlər: hər aktiv müqavilə bir sətir (arxivdəki şəxslər xaric).
 * scope — şöbə rəhbəri üçün bölmə id-ləri (null = bütün təşkilat).
 */
export async function getDashboardDataset(scope: string[] | null): Promise<DashboardDataset> {
  const today = todayUtc();
  const [departments, employments, staffing, absences] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true, level: true, parentId: true }, orderBy: [{ level: "asc" }, { name: "asc" }] }),
    prisma.employment.findMany({
      where: { status: { not: "TERMINATED" }, person: { deletedAt: null }, ...(scope ? { departmentId: { in: scope } } : {}) },
      select: {
        id: true,
        personId: true,
        departmentId: true,
        hireDate: true,
        baseSalary: true,
        unitShare: true,
        status: true,
        position: { select: { name: true, staffCategory: true, hazardousAllowancePct: true } },
        person: {
          select: {
            code: true,
            fullName: true,
            gender: true,
            taxExemptionClause: true,
            academicDegrees: { select: { degree: true } },
            academicTitles: { select: { title: true } },
          },
        },
      },
    }),
    // Hər (bölmə, vəzifə) üçün ən son dövrün ştat vahidi
    prisma.$queryRaw<{ departmentId: string; staffCategory: keyof typeof STAFF_CATEGORY_LABELS; unitCount: number }[]>`
      SELECT DISTINCT ON (s."departmentId", s."positionId") s."departmentId", p."staffCategory", s."unitCount"::float8 AS "unitCount"
      FROM "StaffingUnit" s JOIN "Position" p ON p.id = s."positionId"
      ORDER BY s."departmentId", s."positionId", s."periodDate" DESC`,
    prisma.absence.findMany({ where: { startDate: { lte: today }, endDate: { gte: today } }, select: { personId: true } }),
  ]);

  const byId = new Map(departments.map((d) => [d.id, d]));
  const pathCache = new Map<string, DeptRef[]>();
  const pathOf = (id: string): DeptRef[] => {
    const cached = pathCache.get(id);
    if (cached) return cached;
    const d = byId.get(id);
    const path = d ? [...(d.parentId ? pathOf(d.parentId) : []), { id: d.id, name: d.name, level: d.level }] : [];
    pathCache.set(id, path);
    return path;
  };
  const absent = new Set(absences.map((a) => a.personId));

  const rows: DashboardRow[] = employments.map((e) => {
    const degrees = e.person.academicDegrees.map((d) => d.degree);
    const payroll = computePayroll({
      baseSalary: Number(e.baseSalary),
      degrees,
      titles: e.person.academicTitles.map((t) => t.title),
      hazardousAllowancePct: e.position.hazardousAllowancePct === null ? null : Number(e.position.hazardousAllowancePct),
      taxExemptionClause: e.person.taxExemptionClause,
    });
    return {
      employmentId: e.id,
      personId: e.personId,
      code: e.person.code,
      fullName: e.person.fullName,
      gender: e.person.gender === "MALE" ? "Kişi" : "Qadın",
      category: STAFF_CATEGORY_LABELS[e.position.staffCategory],
      position: e.position.name,
      degree: degrees.includes("DSC") ? "Elmlər doktoru" : degrees.includes("PHD") ? "Fəlsəfə doktoru" : "Elmi dərəcəsiz",
      deptPath: pathOf(e.departmentId),
      hireDate: e.hireDate.toISOString(),
      hireYear: e.hireDate.getUTCFullYear(),
      unitShare: Number(e.unitShare),
      gross: payroll.gross,
      net: payroll.net,
      employerCost: payroll.employerCost,
      onLeave: e.status === "ON_LEAVE" || absent.has(e.personId),
    };
  });

  const staffingRows: StaffingRow[] = staffing
    .filter((s) => !scope || scope.includes(s.departmentId))
    .map((s) => ({ deptPath: pathOf(s.departmentId).map((d) => d.id), category: STAFF_CATEGORY_LABELS[s.staffCategory], units: s.unitCount }));

  return {
    rows,
    staffing: staffingRows,
    departments: departments.filter((d) => !scope || scope.includes(d.id)),
  };
}
