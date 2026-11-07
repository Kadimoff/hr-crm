import "server-only";
import type { DepartmentKind, Prisma, StaffCategory } from "@prisma/client";
import { compareDepartments, effectiveKind, structureAsOf, type ChangeRecord } from "./org-structure";
import { computeLeaveEntitlement, workYearContaining } from "./calc/leave";
import { computePayroll, primaryEmploymentIds, type PayrollInput } from "./calc/payroll";
import { computeSeniority, todayUtc } from "./calc/seniority";
import {
  deriveLegacyEvents,
  financialSnapshotAt,
  formatFinanceValue,
  newestFirst,
  num2,
  type EmploymentNow,
  type FinanceEvent,
  type FinanceFieldCode,
  type FinanceSourceCode,
  type PersonNow,
} from "./finance-history";
import { activeUnpaidLeave } from "./leave-rules";
import { maskMovementSalary } from "./salary-privacy";
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
  unitShare: unknown;
  isPrimary: boolean;
  position: { hazardousAllowancePct: unknown };
  person: { taxExemptionClause: string | null; academicDegrees: { degree: "PHD" | "DSC" }[]; academicTitles: { title: PayrollInput["titles"][number] }[] };
}): PayrollInput {
  return {
    baseSalary: Number(e.baseSalary),
    degrees: e.person.academicDegrees.map((d) => d.degree),
    titles: e.person.academicTitles.map((t) => t.title),
    hazardousAllowancePct: e.position.hazardousAllowancePct === null ? null : Number(e.position.hazardousAllowancePct),
    taxExemptionClause: e.person.taxExemptionClause,
    isPrimary: e.isPrimary,
    unitShare: Number(e.unitShare),
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
export async function getEmployeeRows(
  scope: string[] | null = null,
  opts: { archived?: boolean; employment?: Prisma.EmploymentWhereInput; /** Maaşı gizlədilən şəxslər — oklad null göndərilir */ hidden?: ReadonlySet<string> } = {},
) {
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
      // Bu gün davam edən ödənişsiz məzuniyyət — siyahıda nişan
      absences: { where: { cancelledAt: null, type: { in: ["UNPAID", "SOCIAL_UNPAID"] }, startDate: { lte: todayUtc() }, endDate: { gte: todayUtc() } }, select: { type: true, startDate: true, endDate: true }, take: 1 },
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
    const salaryHidden = !!opts.hidden?.has(p.id);
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
      // Məxfi maaş: rəqəm ümumiyyətlə göndərilmir (sıralama/filtr ilə də sızmır)
      baseSalary: main && !salaryHidden ? Number(main.baseSalary) : null,
      salaryHidden,
      status: main?.status ?? null,
      contracts: p._count.employments,
      createdBy: p.createdBy?.username ?? null,
      createdAt: p.createdAt.toISOString(),
      deletedAt: p.deletedAt?.toISOString() ?? null,
      degree: p.academicDegrees.some((d) => d.degree === "DSC") ? "Elmlər doktoru" : p.academicDegrees.length ? "Fəlsəfə doktoru" : null,
      title: p.academicTitles.some((t) => t.title === "PROFESSOR") ? "Professor" : p.academicTitles.some((t) => t.title === "DOCENT") ? "Dosent" : null,
      unpaidLeave: p.absences[0]
        ? { type: p.absences[0].type as "UNPAID" | "SOCIAL_UNPAID", from: p.absences[0].startDate.toISOString(), to: p.absences[0].endDate.toISOString() }
        : null,
    };
  });
}

export type EmployeeRow = Awaited<ReturnType<typeof getEmployeeRows>>[number];

// ----------------------------------------------------------------------------
//  Əməkdaş 360° dosyesi
// ----------------------------------------------------------------------------

/**
 * hideSalary — maaş məxfidir (çağıran tərəf {@link hiddenSalaryPersonIds} ilə yoxlayır): oklad, oklad tarixçəsi,
 * hərəkətlərin əvvəl→sonra okladı və əməkhaqqı hesablaması nəticədən çıxarılır — RSC payload-a da düşmür.
 */
export async function getDossier(id: string, opts: { hideSalary?: boolean } = {}) {
  const hide = !!opts.hideSalary;
  const raw = await prisma.person.findUnique({
    where: { id },
    include: {
      createdBy: { select: { username: true, fullName: true } },
      updatedBy: { select: { username: true, fullName: true } },
      deletedBy: { select: { username: true, fullName: true } },
      employments: {
        include: {
          position: true,
          department: true,
          salaryHistory: { orderBy: { validFrom: "desc" } },
          movements: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], include: { createdBy: { select: { fullName: true, username: true } } } },
        },
        orderBy: { hireDate: "desc" },
      },
      workHistory: { orderBy: { startDate: "desc" } },
      militaryRecord: true,
      disabilities: { orderBy: { issueDate: "desc" } },
      familyMembers: { orderBy: { birthDate: "asc" } },
      leaveBalances: { orderBy: { periodStart: "desc" } },
      absences: { orderBy: { startDate: "desc" }, include: { createdBy: { select: { fullName: true } }, cancelledBy: { select: { fullName: true } } } },
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
  if (!raw) return null;
  const p = {
    ...raw,
    employments: raw.employments.map((e) => ({
      ...e,
      baseSalary: hide ? null : e.baseSalary,
      salaryHistory: hide ? [] : e.salaryHistory,
      movements: e.movements.map((m) => maskMovementSalary(m, hide)),
    })),
  };

  const today = todayUtc();
  const active = p.employments.filter((e) => e.status !== "TERMINATED");
  const main = active.find((e) => e.isPrimary) ?? active[0] ?? p.employments[0] ?? null;

  const seniority = computeSeniority(
    { years: p.laborSeniorityYears, months: p.laborSeniorityMonths, days: p.laborSeniorityDays },
    p.employments.map((e) => ({ start: e.hireDate, end: e.terminationDate })),
    // Ləğv edilmiş əmrli məzuniyyət stajdan çıxılmır
    p.absences.filter((a) => a.type === "UNPAID" && !a.cancelledAt).map((a) => ({ start: a.startDate, end: a.endDate })),
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

  // Maaş gizlədilibsə hesablama da yoxdur (brutto/netto okladdan geri hesablana bilər)
  const payroll =
    main && main.baseSalary !== null
      ? computePayroll(
          payrollInput({
            baseSalary: main.baseSalary,
            unitShare: main.unitShare,
            // Güzəşt / əlavələr yalnız əsas iş yeri müqaviləsində (dashboard və hesabatlarla eyni qayda)
            isPrimary: primaryEmploymentIds(active.map((e) => ({ ...e, personId: p.id }))).has(main.id),
            position: main.position,
            person: { taxExemptionClause: p.taxExemptionClause, academicDegrees: p.academicDegrees, academicTitles: p.academicTitles },
          }),
        )
      : null;

  const carryover = p.leaveBalances.reduce(
    (s, b) => s + Number(b.basicDays) + Number(b.seniorityDays) + Number(b.hazardousDays) + Number(b.motherhoodDays),
    0,
  );

  return { person: p, main, seniority, leave, payroll, carryover, unpaidLeave: activeUnpaidLeave(p.absences, today), salaryHidden: hide };
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
  /** Növ (köhnə qeyddə fakültə/kafedra bayrağından təxmin edilir) */
  kind: DepartmentKind | null;
  sortOrder: number | null;
  /** Ayrıca hüquqi şəxs — üst bölmənin və ümumi cəmlərə daxil edilmir, ayrıca göstərilir */
  isExternal: boolean;
  /** Ştatsız qrup / kollegial düyün — öz ştatı və vakansiyası sayılmır */
  isGroup: boolean;
  headPositionTitle: string | null;
  campus: string | null;
  budgetCenter: string | null;
  closedOn: string | null; // YYYY-MM-DD
  /** Qüvvədə olan əsasnamə (təsdiqlənmiş ən son versiya) */
  charter: { id: string; version: number; title: string; nextReviewOn: string | null } | null;
  /** Gələcək tarixə planlaşdırılmış (hələ tətbiq olunmamış) dəyişikliklər */
  planned: number;
  closed: boolean;
  /** Maaşlar məxfidir (bölmənin öz işarəsi; alt bölmələr də məxfi sayılır) */
  salaryRestricted: boolean;
  createdOn: string; // YYYY-MM-DD
  units: number;
  filled: number;
  headcount: number;
  children: OrgNode[];
}

/**
 * Struktur ağacı. asOf verilibsə — həmin günün strukturu (DepartmentChange-dən ad / tabelik bərpası, yaradılma və
 * bağlanma tarixlərinə görə süzgəc); bu halda heyət və ştat göstəriciləri sıfırdır (yalnız struktur).
 * Sıra: sortOrder → kod. Ayrıca hüquqi şəxslər üst bölmənin cəminə daxil edilmir.
 */
export async function getOrgTree(opts: { asOf?: Date } = {}): Promise<OrgNode[]> {
  const historical = !!opts.asOf;
  const [rawDepartments, staffing, employments, charters, planned, changes] = await Promise.all([
    prisma.department.findMany({ orderBy: [{ level: "asc" }, { name: "asc" }] }),
    historical ? Promise.resolve([]) : latestStaffing(),
    historical
      ? Promise.resolve([])
      : prisma.employment.findMany({ where: { status: { not: "TERMINATED" }, person: { deletedAt: null } }, select: { departmentId: true, unitShare: true } }),
    prisma.departmentCharter.findMany({ where: { status: "TESDIQLENIB" }, orderBy: { version: "desc" }, select: { id: true, departmentId: true, version: true, title: true, nextReviewOn: true } }),
    prisma.departmentChange.groupBy({ by: ["departmentId"], where: { appliedAt: null, cancelledAt: null }, _count: { _all: true } }),
    historical ? prisma.departmentChange.findMany({ select: { departmentId: true, kind: true, effectiveDate: true, before: true, after: true, appliedAt: true, cancelledAt: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  const today = todayUtc();
  const asOf = opts.asOf ?? today;
  const departments = historical ? structureAsOf(rawDepartments, changes as ChangeRecord[], asOf) : rawDepartments;
  const charterOf = new Map<string, (typeof charters)[number]>();
  for (const c of charters) if (!charterOf.has(c.departmentId)) charterOf.set(c.departmentId, c);
  const plannedOf = new Map(planned.map((p) => [p.departmentId, p._count._all]));
  const nodes = new Map<string, OrgNode>();
  for (const d of departments) {
    const ch = charterOf.get(d.id);
    nodes.set(d.id, {
      id: d.id,
      code: d.code,
      name: d.name,
      level: d.level,
      isFaculty: d.isFaculty,
      isChair: d.isChair,
      kind: effectiveKind(d),
      sortOrder: d.sortOrder,
      isExternal: d.isExternal,
      isGroup: d.isGroup,
      headPositionTitle: d.headPositionTitle,
      campus: d.campus,
      budgetCenter: d.budgetCenter,
      closedOn: d.closedOn ? d.closedOn.toISOString().slice(0, 10) : null,
      charter: ch ? { id: ch.id, version: ch.version, title: ch.title, nextReviewOn: ch.nextReviewOn?.toISOString().slice(0, 10) ?? null } : null,
      planned: plannedOf.get(d.id) ?? 0,
      closed: !!d.closedOn && d.closedOn <= asOf,
      salaryRestricted: d.salaryRestricted,
      createdOn: d.createdOn.toISOString().slice(0, 10),
      units: 0,
      filled: 0,
      headcount: 0,
      children: [],
    });
  }
  for (const s of staffing) {
    const n = nodes.get(s.departmentId);
    // Ştatsız qrup düyünü: ştat və vakansiya sayılmır
    if (n && !n.isGroup) n.units += s.unitCount;
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
  // Alt bölmələrin göstəricilərini yuxarı toplayırıq (ayrıca hüquqi şəxslər istisna — onlar ayrıca göstərilir)
  const roll = (n: OrgNode): OrgNode => {
    n.children.sort(compareDepartments);
    for (const c of n.children) {
      roll(c);
      if (c.isExternal) continue;
      n.units += c.units;
      n.filled += c.filled;
      n.headcount += c.headcount;
    }
    return n;
  };
  return roots.sort(compareDepartments).map(roll);
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
  /** null — maaş məxfidir (göndərilmir) */
  baseSalary: number | null;
  /** Maaşı dəyişə bilməz (məxfi və ya öz maaşı) — sürətli redaktədə sahə kilidlidir */
  salaryLocked: boolean;
  unitShare: number;
  isPrimary: boolean;
  status: "ACTIVE" | "ON_LEAVE";
  /** Person.updatedAt (ISO) — sürətli redaktədə optimistik kilid üçün */
  personUpdatedAt: string;
  mobilePhone: string | null;
  workPhone: string | null;
  email: string | null;
}

/** scope — şöbə rəhbəri üçün bölmə id-ləri (null = bütün təşkilat); hidden / locked — maaşı gizlədilən / kilidli şəxslər */
export async function getOrgStaff(scope: string[] | null, salary: { hidden: ReadonlySet<string>; locked: ReadonlySet<string> }): Promise<OrgStaff[]> {
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
          updatedAt: true,
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
      baseSalary: salary.hidden.has(e.person.id) ? null : Number(e.baseSalary),
      salaryLocked: salary.locked.has(e.person.id),
      unitShare: Number(e.unitShare),
      isPrimary: e.isPrimary,
      status: e.status === "ON_LEAVE" ? "ON_LEAVE" : "ACTIVE",
      personUpdatedAt: e.person.updatedAt.toISOString(),
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

/**
 * Redaktə forması üçün başlanğıc dəyərlər (hamısı string — <input> üçün).
 * salary.hidden — oklad göndərilmir ("salaryHidden"="1"); salary.locked — oklad sahəsi kilidlidir ("salaryLocked"="1").
 */
export async function getPersonFormValues(id: string, salary: { hidden: boolean; locked: boolean }): Promise<Record<string, string> | null> {
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
    // Eyni vaxtda redaktə: forma açılanda olan versiya — yadda saxlayanda yoxlanılır
    updatedAt: p.updatedAt.toISOString(),
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
    baseSalary: main && !salary.hidden ? String(Number(main.baseSalary)) : "",
    salaryHidden: salary.hidden ? "1" : "",
    salaryLocked: salary.locked ? "1" : "",
    unitShare: main ? String(Number(main.unitShare)) : "",
    status: main?.status ?? "",
    terminationDate: isoDay(main?.terminationDate),
    terminationArticle: main?.terminationArticle ?? "",
  };
}

// ----------------------------------------------------------------------------
//  Maliyyə tarixçəsi — zaman xətti və «tarixə görə baxış»
//  Çağıran tərəf icazəni (finance.history) yoxlamalıdır
// ----------------------------------------------------------------------------

export interface FinanceTimelineRow {
  key: string;
  date: Date;
  field: FinanceFieldCode | "HIRE" | "TERMINATION";
  employment: string | null;
  oldText: string | null;
  newText: string | null;
  oldValue: string | null;
  newValue: string | null;
  oldLabel: string | null;
  newLabel: string | null;
  source: FinanceSourceCode | "HIRE" | "TERMINATION";
  orderNumber: string | null;
  orderDate: Date | null;
  by: string | null;
  createdAt: Date | null;
  derived: boolean;
}

/** asOf — «tarixə görə baxış» günü (null — yalnız zaman xətti) */
export async function getFinanceHistory(personId: string, asOf: Date | null) {
  const p = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      taxExemptionClause: true,
      academicDegrees: { select: { degree: true, degreeName: true, awardDate: true } },
      academicTitles: { select: { title: true, titleName: true, awardDate: true } },
      financialChanges: { include: { createdBy: { select: { fullName: true } } } },
      employments: {
        orderBy: { hireDate: "asc" },
        include: {
          department: { select: { name: true } },
          position: { select: { name: true } },
          salaryHistory: { orderBy: { validFrom: "asc" } },
          movements: { include: { createdBy: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!p) return null;
  const positions = await prisma.position.findMany({ select: { id: true, hazardousAllowancePct: true } });
  const positionPct = new Map(positions.map((x) => [x.id, x.hazardousAllowancePct === null ? null : Number(x.hazardousAllowancePct)]));

  const emps: EmploymentNow[] = p.employments.map((e) => ({
    id: e.id,
    hireDate: e.hireDate,
    terminationDate: e.terminationDate,
    isPrimary: e.isPrimary,
    departmentId: e.departmentId,
    departmentName: e.department.name,
    positionId: e.positionId,
    positionName: e.position.name,
    baseSalary: Number(e.baseSalary),
    unitShare: Number(e.unitShare),
    paymentForm: e.paymentForm,
    salaryHistory: e.salaryHistory.map((r) => ({ baseSalary: Number(r.baseSalary), validFrom: r.validFrom, validTo: r.validTo })),
    movements: e.movements.map((m) => ({
      id: m.id,
      orderNumber: m.orderNumber,
      orderDate: m.orderDate,
      effectiveDate: m.effectiveDate,
      fromDepartmentId: m.fromDepartmentId,
      fromDepartment: m.fromDepartment,
      toDepartmentId: m.toDepartmentId,
      toDepartment: m.toDepartment,
      fromPositionId: m.fromPositionId,
      fromPosition: m.fromPosition,
      toPositionId: m.toPositionId,
      toPosition: m.toPosition,
      fromSalary: m.fromSalary === null ? null : Number(m.fromSalary),
      toSalary: m.toSalary === null ? null : Number(m.toSalary),
      fromUnitShare: m.fromUnitShare === null ? null : Number(m.fromUnitShare),
      toUnitShare: m.toUnitShare === null ? null : Number(m.toUnitShare),
      createdAt: m.createdAt,
      by: m.createdBy?.fullName ?? null,
    })),
  }));
  const explicit: FinanceEvent[] = p.financialChanges.map((c) => ({
    key: c.id,
    employmentId: c.employmentId,
    field: c.field,
    oldValue: c.oldValue,
    newValue: c.newValue,
    oldLabel: c.oldLabel,
    newLabel: c.newLabel,
    effectiveDate: c.effectiveDate,
    source: c.source,
    orderNumber: c.orderNumber,
    orderDate: c.orderDate,
    by: c.createdBy?.fullName ?? null,
    createdAt: c.createdAt,
    derived: false,
  }));
  const linked = new Set(p.financialChanges.map((c) => c.movementId).filter((x): x is string => !!x));
  const events = [...explicit, ...deriveLegacyEvents(emps, explicit, linked)];
  const personNow: PersonNow = {
    taxExemptionClause: p.taxExemptionClause,
    degrees: p.academicDegrees.map((d) => ({ degree: d.degree, name: d.degreeName, awardDate: d.awardDate })),
    titles: p.academicTitles.map((t) => ({ title: t.title, name: t.titleName, awardDate: t.awardDate })),
  };

  const label = new Map(emps.map((e) => [e.id, `${e.positionName} · ${e.departmentName}${e.isPrimary ? "" : " (əvəzçilik)"}`]));
  const timeline: FinanceTimelineRow[] = [
    ...events.sort(newestFirst).map((ev) => ({
      key: ev.key,
      date: ev.effectiveDate,
      field: ev.field,
      employment: ev.employmentId ? (label.get(ev.employmentId) ?? null) : null,
      oldText: null,
      newText: null,
      oldValue: ev.oldValue,
      newValue: ev.newValue,
      oldLabel: ev.oldLabel,
      newLabel: ev.newLabel,
      source: ev.source,
      orderNumber: ev.orderNumber,
      orderDate: ev.orderDate,
      by: ev.by,
      createdAt: ev.derived && ev.source === "SALARY_RECORD" ? null : ev.createdAt,
      derived: ev.derived,
    })),
    // İşə qəbul: ilkin vəziyyət — bütün sonrakı dəyişikliklər geri açılmaqla
    ...emps.map((e) => {
      const s = financialSnapshotAt(personNow, [e], events, e.hireDate, positionPct).employments[0];
      return {
        key: `hire:${e.id}`,
        date: e.hireDate,
        field: "HIRE" as const,
        employment: label.get(e.id) ?? null,
        oldText: null,
        newText: s ? `${s.positionName} · ${s.departmentName}; oklad ${formatFinanceValue("BASE_SALARY", num2(s.baseSalary), null)}; ştat ${formatFinanceValue("UNIT_SHARE", num2(s.unitShare), null)}; ${s.paymentForm}` : null,
        oldValue: null,
        newValue: null,
        oldLabel: null,
        newLabel: null,
        source: "HIRE" as const,
        orderNumber: null,
        orderDate: null,
        by: null,
        createdAt: null,
        derived: false,
      };
    }),
    ...emps
      .filter((e) => e.terminationDate)
      .map((e) => ({
        key: `term:${e.id}`,
        date: e.terminationDate!,
        field: "TERMINATION" as const,
        employment: label.get(e.id) ?? null,
        oldText: null,
        newText: "Müqavilə xitam edildi — oklad dayandırıldı",
        oldValue: null,
        newValue: null,
        oldLabel: null,
        newLabel: null,
        source: "TERMINATION" as const,
        orderNumber: null,
        orderDate: null,
        by: null,
        createdAt: null,
        derived: false,
      })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  return {
    timeline,
    snapshot: asOf ? financialSnapshotAt(personNow, emps, events, asOf, positionPct) : null,
    salaryHistory: p.employments.map((e) => ({ employment: label.get(e.id) ?? "", records: [...e.salaryHistory].reverse() })).filter((x) => x.records.length > 0),
  };
}

export type FinanceHistory = NonNullable<Awaited<ReturnType<typeof getFinanceHistory>>>;
