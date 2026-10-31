import "server-only";
import type { Prisma, StaffCategory } from "@prisma/client";
import { computeLeaveEntitlement, workYearContaining } from "./calc/leave";
import { computePayroll, type PayrollInput } from "./calc/payroll";
import { computeSeniority, todayUtc } from "./calc/seniority";
import { personScopeWhere } from "./auth/scope";
import { UNIT_GROUPS, type UnitGroup, type UnitNode } from "./personnel";
import { prisma } from "./db";

export const STAFF_CATEGORY_LABELS: Record<StaffCategory, string> = {
  INZIBATI: "İnzibati",
  PROFESSOR_MUELLIM: "Professor-müəllim",
  TEDRIS_KOMEKCI: "Tədris-köməkçi",
  XIDMETEDICI: "Xidmətedici",
};

/** Hər (bölmə, vəzifə) cütü üçün ən son dövrün ştat vahidi */
async function latestStaffing() {
  return prisma.$queryRaw<{ departmentId: string; positionId: string; unitCount: number; minSalary: number; maxSalary: number }[]>`
    SELECT DISTINCT ON ("departmentId", "positionId")
      "departmentId", "positionId", "unitCount"::float8 AS "unitCount", "minSalary"::float8 AS "minSalary", "maxSalary"::float8 AS "maxSalary"
    FROM "StaffingUnit"
    ORDER BY "departmentId", "positionId", "periodDate" DESC`;
}

function payrollInput(e: {
  baseSalary: unknown;
  position: { hazardousAllowancePct: unknown };
  person: { taxExemptionClause: string | null; academicDegrees: { degree: "PHD" | "DSC" }[]; academicTitles: { title: PayrollInput["titles"][number] }[] };
}): PayrollInput {
  return {
    baseSalary: Number(e.baseSalary),
    degrees: e.person.academicDegrees.map((d) => d.degree),
    titles: e.person.academicTitles.map((t) => t.title),
    hazardousAllowancePct: e.position.hazardousAllowancePct === null ? null : Number(e.position.hazardousAllowancePct),
    taxExemptionClause: e.person.taxExemptionClause,
  };
}

// ----------------------------------------------------------------------------
//  İdarə paneli
// ----------------------------------------------------------------------------

export async function getRecentImports() {
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { files: { select: { fileName: true } } } });
  return batches.map((b) => ({ id: b.id, status: b.status, createdAt: b.createdAt.toISOString(), files: b.files.map((f) => f.fileName) }));
}

export type RecentImport = Awaited<ReturnType<typeof getRecentImports>>[number];

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "az");

/** «Şəxsi iş» menyusunun struktur ağacı: vahidlər və alt bölmələri, əlifba sırası ilə */
export async function getUnitTree(group: UnitGroup): Promise<UnitNode[]> {
  const nodes = await prisma.department.findMany({
    where: { ...UNIT_GROUPS[group], closedOn: null },
    select: { id: true, name: true, children: { where: { closedOn: null }, select: { id: true, name: true } } },
  });
  return nodes.map((n) => ({ ...n, children: n.children.sort(byName) })).sort(byName);
}

/** Sidebar xülasəsi: son idxal, ştat doluluğu, menyu ağacı (scope — şöbə rəhbəri üçün bölmə id-ləri; withRequests — root üçün sorğu sayı) */
export async function getSidebarSummary(scope: string[] | null, withRequests = false) {
  const [last, filled, staffing, faculties, admin, pendingRequests] = await Promise.all([
    prisma.importBatch.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } }),
    prisma.employment.aggregate({
      where: { status: { not: "TERMINATED" }, person: { deletedAt: null }, ...(scope ? { departmentId: { in: scope } } : {}) },
      _sum: { unitShare: true },
    }),
    // Hər (bölmə, vəzifə) üçün ən son dövrün ştat vahidi — idarə panelindəki kimi
    prisma.$queryRaw<{ departmentId: string; unitCount: number }[]>`
      SELECT DISTINCT ON (s."departmentId", s."positionId") s."departmentId", s."unitCount"::float8 AS "unitCount"
      FROM "StaffingUnit" s
      ORDER BY s."departmentId", s."positionId", s."periodDate" DESC`,
    // «Şəxsi iş» alt menyuları
    getUnitTree("faculties"),
    getUnitTree("admin"),
    // Root üçün: gözləyən silmə sorğuları
    withRequests ? prisma.documentDeletionRequest.count({ where: { status: "PENDING" } }) : 0,
  ]);
  const totalUnits = staffing.filter((s) => !scope || scope.includes(s.departmentId)).reduce((sum, s) => sum + s.unitCount, 0);
  return {
    lastImport: last ? { createdAt: last.createdAt.toISOString(), status: last.status } : null,
    filledUnits: Number(filled._sum.unitShare ?? 0),
    totalUnits,
    units: { faculties, admin } satisfies Record<UnitGroup, UnitNode[]>,
    pendingRequests,
  };
}

export type SidebarSummary = Awaited<ReturnType<typeof getSidebarSummary>>;

// ----------------------------------------------------------------------------
//  Əməkdaşlar siyahısı
// ----------------------------------------------------------------------------

/**
 * scope — şöbə rəhbəri üçün bölmə id-ləri; archived — yalnız arxivdəkilər;
 * employment — yalnız belə aktiv iş yeri olanlar, sətirdəki vəzifə/bölmə də həmin iş yerindən götürülür
 */
export async function getEmployeeRows(scope: string[] | null = null, opts: { archived?: boolean; employment?: Prisma.EmploymentWhereInput } = {}) {
  const match: Prisma.EmploymentWhereInput | undefined = opts.employment && {
    AND: [opts.employment, scope ? { departmentId: { in: scope } } : {}],
    status: { not: "TERMINATED" },
  };
  const persons = await prisma.person.findMany({
    where: match ? { AND: [personScopeWhere(scope, opts), { employments: { some: match } }] } : personScopeWhere(scope, opts),
    orderBy: { fullName: "asc" },
    select: {
      _count: { select: { employments: true } },
      createdAt: true,
      deletedAt: true,
      createdBy: { select: { username: true } },
      id: true,
      code: true,
      fullName: true,
      gender: true,
      birthDate: true,
      fin: true,
      email: true,
      mobilePhone: true,
      academicDegrees: { select: { degree: true } },
      academicTitles: { select: { title: true } },
      employments: {
        where: match,
        orderBy: [{ isPrimary: "desc" }, { hireDate: "desc" }],
        select: {
          status: true,
          hireDate: true,
          baseSalary: true,
          isPrimary: true,
          position: { select: { name: true, staffCategory: true } },
          department: { select: { name: true } },
        },
      },
    },
  });
  return persons.map((p) => {
    const main = p.employments.find((e) => e.status !== "TERMINATED") ?? p.employments[0];
    return {
      id: p.id,
      code: p.code,
      fullName: p.fullName,
      gender: p.gender,
      birthDate: p.birthDate.toISOString(),
      fin: p.fin,
      email: p.email,
      phone: p.mobilePhone,
      position: main?.position.name ?? null,
      staffCategory: main ? STAFF_CATEGORY_LABELS[main.position.staffCategory] : null,
      department: main?.department.name ?? null,
      hireDate: main?.hireDate.toISOString() ?? null,
      baseSalary: main ? Number(main.baseSalary) : null,
      status: main?.status ?? null,
      contracts: p._count.employments,
      createdBy: p.createdBy?.username ?? null,
      createdAt: p.createdAt.toISOString(),
      deletedAt: p.deletedAt?.toISOString() ?? null,
      degree: p.academicDegrees.some((d) => d.degree === "DSC") ? "Elmlər doktoru" : p.academicDegrees.length ? "Fəlsəfə doktoru" : null,
      title: p.academicTitles.some((t) => t.title === "PROFESSOR") ? "Professor" : p.academicTitles.some((t) => t.title === "DOCENT") ? "Dosent" : null,
    };
  });
}

export type EmployeeRow = Awaited<ReturnType<typeof getEmployeeRows>>[number];

// ----------------------------------------------------------------------------
//  Əməkdaş 360° dosyesi
// ----------------------------------------------------------------------------

export async function getDossier(id: string) {
  const p = await prisma.person.findUnique({
    where: { id },
    include: {
      createdBy: { select: { username: true, fullName: true } },
      updatedBy: { select: { username: true, fullName: true } },
      deletedBy: { select: { username: true, fullName: true } },
      employments: { include: { position: true, department: true, salaryHistory: { orderBy: { validFrom: "desc" } } }, orderBy: { hireDate: "desc" } },
      workHistory: { orderBy: { startDate: "desc" } },
      militaryRecord: true,
      disabilities: { orderBy: { issueDate: "desc" } },
      familyMembers: { orderBy: { birthDate: "asc" } },
      leaveBalances: { orderBy: { periodStart: "desc" } },
      absences: { orderBy: { startDate: "desc" } },
      intellectualProps: true,
      projects: { orderBy: { startDate: "desc" } },
      events: { orderBy: { date: "desc" } },
      publications: { orderBy: { publishedDate: "desc" } },
      attestations: { orderBy: { date: "desc" } },
      researchTopics: true,
      languages: true,
      educations: { orderBy: { graduationDate: "desc" } },
      skills: true,
      academicDegrees: true,
      academicTitles: true,
      awards: true,
      partyMemberships: true,
      electedOrgans: true,
      legalLiabilities: true,
      documents: { orderBy: [{ documentDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], include: {
          uploadedBy: { select: { fullName: true } },
          deletionRequests: { where: { status: "PENDING" }, take: 1, select: { reason: true, requestedBy: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!p) return null;

  const today = todayUtc();
  const active = p.employments.filter((e) => e.status !== "TERMINATED");
  const main = active.find((e) => e.isPrimary) ?? active[0] ?? p.employments[0] ?? null;

  const seniority = computeSeniority(
    { years: p.laborSeniorityYears, months: p.laborSeniorityMonths, days: p.laborSeniorityDays },
    p.employments.map((e) => ({ start: e.hireDate, end: e.terminationDate })),
    p.absences.filter((a) => a.type === "UNPAID").map((a) => ({ start: a.startDate, end: a.endDate })),
    today,
  );

  const leave = main
    ? (() => {
        const year = workYearContaining(main.hireDate, today);
        const entitlement = computeLeaveEntitlement({
          basicLeaveDays: main.position.basicLeaveDays,
          hazardousLeaveDays: main.position.hazardousLeaveDays,
          seniorityYears: seniority.totalYears,
          gender: p.gender,
          children: p.familyMembers.filter((f) => f.isChild).map((f) => ({ birthDate: f.birthDate, isDisabled: f.isDisabledChild })),
          quotaBasicLeaveDays: p.quotaBasicLeaveDays,
          periodStart: year.start,
        });
        return { periodStart: year.start, periodEnd: year.end, ...entitlement };
      })()
    : null;

  const payroll = main
    ? computePayroll(
        payrollInput({
          baseSalary: main.baseSalary,
          position: main.position,
          person: { taxExemptionClause: p.taxExemptionClause, academicDegrees: p.academicDegrees, academicTitles: p.academicTitles },
        }),
      )
    : null;

  const carryover = p.leaveBalances.reduce(
    (s, b) => s + Number(b.basicDays) + Number(b.seniorityDays) + Number(b.hazardousDays) + Number(b.motherhoodDays),
    0,
  );

  return { person: p, main, seniority, leave, payroll, carryover };
}

export type Dossier = NonNullable<Awaited<ReturnType<typeof getDossier>>>;

// ----------------------------------------------------------------------------
//  Struktur ağacı
// ----------------------------------------------------------------------------

export interface OrgNode {
  id: string;
  code: string;
  name: string;
  level: number;
  isFaculty: boolean;
  isChair: boolean;
  closed: boolean;
  createdOn: string; // YYYY-MM-DD
  units: number;
  filled: number;
  headcount: number;
  children: OrgNode[];
}

export async function getOrgTree(): Promise<OrgNode[]> {
  const [departments, staffing, employments] = await Promise.all([
    prisma.department.findMany({ orderBy: [{ level: "asc" }, { name: "asc" }] }),
    latestStaffing(),
    prisma.employment.findMany({ where: { status: { not: "TERMINATED" }, person: { deletedAt: null } }, select: { departmentId: true, unitShare: true } }),
  ]);
  const today = todayUtc();
  const nodes = new Map<string, OrgNode>();
  for (const d of departments) {
    nodes.set(d.id, {
      id: d.id,
      code: d.code,
      name: d.name,
      level: d.level,
      isFaculty: d.isFaculty,
      isChair: d.isChair,
      closed: !!d.closedOn && d.closedOn <= today,
      createdOn: d.createdOn.toISOString().slice(0, 10),
      units: 0,
      filled: 0,
      headcount: 0,
      children: [],
    });
  }
  for (const s of staffing) {
    const n = nodes.get(s.departmentId);
    if (n) n.units += s.unitCount;
  }
  for (const e of employments) {
    const n = nodes.get(e.departmentId);
    if (n) {
      n.filled += Number(e.unitShare);
      n.headcount += 1;
    }
  }
  const roots: OrgNode[] = [];
  for (const d of departments) {
    const n = nodes.get(d.id)!;
    const parent = d.parentId ? nodes.get(d.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  // Alt bölmələrin göstəricilərini yuxarı toplayırıq
  const roll = (n: OrgNode): OrgNode => {
    for (const c of n.children) {
      roll(c);
      n.units += c.units;
      n.filled += c.filled;
      n.headcount += c.headcount;
    }
    return n;
  };
  return roots.map(roll);
}

/** Struktur xəritəsində bölmələrin heyəti — hər aktiv müqavilə bir kart */
export interface OrgStaff {
  employmentId: string;
  personId: string;
  code: string;
  fin: string;
  fullName: string;
  gender: "MALE" | "FEMALE";
  departmentId: string;
  positionId: string;
  position: string;
  category: string;
  degree: string | null;
  title: string | null;
  hireDate: string;
  baseSalary: number;
  unitShare: number;
  isPrimary: boolean;
  status: "ACTIVE" | "ON_LEAVE";
  mobilePhone: string | null;
  workPhone: string | null;
  email: string | null;
}

/** scope — şöbə rəhbəri üçün bölmə id-ləri (null = bütün təşkilat) */
export async function getOrgStaff(scope: string[] | null): Promise<OrgStaff[]> {
  const rows = await prisma.employment.findMany({
    where: { status: { not: "TERMINATED" }, person: { deletedAt: null }, ...(scope ? { departmentId: { in: scope } } : {}) },
    orderBy: { person: { fullName: "asc" } },
    select: {
      id: true,
      departmentId: true,
      positionId: true,
      hireDate: true,
      baseSalary: true,
      unitShare: true,
      isPrimary: true,
      status: true,
      position: { select: { name: true, staffCategory: true } },
      person: {
        select: {
          id: true,
          code: true,
          fin: true,
          fullName: true,
          gender: true,
          mobilePhone: true,
          workPhone: true,
          email: true,
          academicDegrees: { select: { degree: true } },
          academicTitles: { select: { title: true } },
        },
      },
    },
  });
  return rows.map((e) => {
    const degrees = e.person.academicDegrees.map((d) => d.degree);
    const titles = e.person.academicTitles.map((t) => t.title);
    return {
      employmentId: e.id,
      personId: e.person.id,
      code: e.person.code,
      fin: e.person.fin,
      fullName: e.person.fullName,
      gender: e.person.gender,
      departmentId: e.departmentId,
      positionId: e.positionId,
      position: e.position.name,
      category: STAFF_CATEGORY_LABELS[e.position.staffCategory],
      degree: degrees.includes("DSC") ? "Elmlər doktoru" : degrees.includes("PHD") ? "Fəlsəfə doktoru" : null,
      title: titles.includes("PROFESSOR") ? "Professor" : titles.includes("DOCENT") ? "Dosent" : null,
      hireDate: e.hireDate.toISOString(),
      baseSalary: Number(e.baseSalary),
      unitShare: Number(e.unitShare),
      isPrimary: e.isPrimary,
      status: e.status === "ON_LEAVE" ? "ON_LEAVE" : "ACTIVE",
      mobilePhone: e.person.mobilePhone,
      workPhone: e.person.workPhone,
      email: e.person.email,
    };
  });
}

// ----------------------------------------------------------------------------
//  Əməkdaş forması (əlavə / redaktə)
// ----------------------------------------------------------------------------

export async function getPersonFormOptions() {
  const today = todayUtc();
  const [departments, positions] = await Promise.all([
    prisma.department.findMany({
      where: { OR: [{ closedOn: null }, { closedOn: { gt: today } }] },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, level: true },
    }),
    prisma.position.findMany({
      where: { OR: [{ validTo: null }, { validTo: { gt: today } }] },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, staffCategory: true },
    }),
  ]);
  return {
    departments: departments.map((d) => ({ value: d.id, label: d.name, hint: d.code })),
    positions: positions.map((p) => ({ value: p.id, label: p.name, hint: STAFF_CATEGORY_LABELS[p.staffCategory] })),
  };
}

export type PersonFormOptions = Awaited<ReturnType<typeof getPersonFormOptions>>;

const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** Redaktə forması üçün başlanğıc dəyərlər (hamısı string — <input> üçün) */
export async function getPersonFormValues(id: string): Promise<Record<string, string> | null> {
  const p = await prisma.person.findFirst({
    where: { id, deletedAt: null },
    include: { employments: { orderBy: { hireDate: "desc" } } },
  });
  if (!p) return null;
  const active = p.employments.filter((e) => e.status !== "TERMINATED");
  // getDossier ilə eyni qayda: əsas aktiv müqavilə → istənilən aktiv → ən sonuncu
  const main = active.find((e) => e.isPrimary) ?? active[0] ?? p.employments[0];
  return {
    id: p.id,
    code: p.code,
    lastName: p.lastName,
    firstName: p.firstName,
    patronymic: p.patronymic ?? "",
    gender: p.gender,
    birthDate: isoDay(p.birthDate),
    maritalStatus: p.maritalStatus ?? "",
    citizenship: p.citizenship ?? "",
    fin: p.fin,
    ssn: p.ssn ?? "",
    idDocType: p.idDocType,
    idDocSeries: p.idDocSeries ?? "",
    idDocNumber: p.idDocNumber,
    idDocIssueDate: isoDay(p.idDocIssueDate),
    idDocIssuedBy: p.idDocIssuedBy ?? "",
    mobilePhone: p.mobilePhone ?? "",
    workPhone: p.workPhone ?? "",
    email: p.email ?? "",
    registeredAddress: p.registeredAddress ?? "",
    livingAddress: p.livingAddress ?? "",
    employmentId: main?.id ?? "",
    departmentId: main?.departmentId ?? "",
    positionId: main?.positionId ?? "",
    hireDate: isoDay(main?.hireDate),
    schedule: main?.schedule ?? "",
    paymentForm: main?.paymentForm ?? "",
    baseSalary: main ? String(Number(main.baseSalary)) : "",
    unitShare: main ? String(Number(main.unitShare)) : "",
    status: main?.status ?? "",
    terminationDate: isoDay(main?.terminationDate),
    terminationArticle: main?.terminationArticle ?? "",
  };
}
