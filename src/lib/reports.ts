import "server-only";
import type { Prisma, StaffCategory } from "@prisma/client";
import { computePayroll, primaryEmploymentIds } from "./calc/payroll";
import { prisma } from "./db";
import { ORDER_LEAVE_LABELS, leaveDays, type OrderLeaveType } from "./leave-rules";
import { describeMovement, isReportEventKind, movementKindOf, REPORT_EVENT_LABELS, type ReportEventKind } from "./movement-rules";
import { STAFF_CATEGORY_LABELS } from "./queries";
import { maskMovementSalary, SALARY_EXCLUDED_NOTE, SALARY_HIDDEN_LABEL } from "./salary-privacy";
import { SALARY_UNKNOWN_NOTE, UNKNOWN_LABEL } from "./unknown-values";
import { formatAzDate } from "./validation/primitives";

export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  header: string;
  /** money — ₼ formatı; number — tam/onluq ədəd; date — DD.MM.YYYY mətn */
  type?: "text" | "number" | "money";
  width?: number;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
  note?: string;
}

export interface ReportParams {
  from?: string; // YYYY-MM-DD
  to?: string;
  status?: "active" | "all";
  /** Kadr hərəkəti: növ filtri (boş — hamısı) */
  kind?: ReportEventKind;
}

/** Hesabatı kim üçün qururuq: bölmə məhdudiyyəti (şöbə rəhbəri) və maaşı gizlədilən şəxslər (maaş məxfiliyi) */
export interface ReportContext {
  scope: string[] | null;
  hidden: ReadonlySet<string>;
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  params: ("period" | "status" | "kind")[];
  run: (ctx: ReportContext, params: ReportParams) => Promise<ReportResult>;
}

const CATEGORIES = Object.keys(STAFF_CATEGORY_LABELS) as StaffCategory[];

/** Bütün hesabatlar üçün ortaq mənbə: arxivdə olmayan şəxslərin müqavilələri (+ bölmə məhdudiyyəti) */
async function employments(scope: string[] | null, where: Prisma.EmploymentWhereInput = { status: { not: "TERMINATED" } }) {
  return prisma.employment.findMany({
    where: { ...where, person: { deletedAt: null }, ...(scope ? { departmentId: { in: scope } } : {}) },
    include: {
      department: { select: { id: true, code: true, name: true, level: true } },
      position: { select: { name: true, staffCategory: true, hazardousAllowancePct: true } },
      person: {
        select: {
          id: true,
          code: true,
          fullName: true,
          gender: true,
          birthDate: true,
          taxExemptionClause: true,
          academicDegrees: { select: { degree: true } },
          academicTitles: { select: { title: true } },
        },
      },
    },
    orderBy: [{ department: { name: "asc" } }, { person: { fullName: "asc" } }],
  });
}

type Emp = Awaited<ReturnType<typeof employments>>[number];

function groupByDepartment(rows: Emp[]) {
  const map = new Map<string, { name: string; code: string; items: Emp[] }>();
  for (const e of rows) {
    const g = map.get(e.departmentId) ?? { name: e.department.name, code: e.department.code, items: [] };
    g.items.push(e);
    map.set(e.departmentId, g);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "az"));
}

const sum = (rows: Record<string, Cell>[], key: string) => rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** primary — güzəşt və əlavələrin tətbiq olunduğu müqavilələr ({@link primaryEmploymentIds}) */
function payrollOf(e: Emp, primary: Set<string>) {
  return computePayroll({
    baseSalary: Number(e.baseSalary ?? 0),
    degrees: e.person.academicDegrees.map((d) => d.degree),
    titles: e.person.academicTitles.map((t) => t.title),
    hazardousAllowancePct: e.position.hazardousAllowancePct === null ? null : Number(e.position.hazardousAllowancePct),
    taxExemptionClause: e.person.taxExemptionClause,
    isPrimary: primary.has(e.id),
    unitShare: Number(e.unitShare),
  });
}

const parseDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : undefined);

export const REPORTS: ReportDef[] = [
  {
    key: "headcount",
    title: "Struktur bölmələri üzrə say",
    description: "Hər bölmədə əməkdaş sayı — cins və heyət kateqoriyası üzrə",
    params: [],
    async run({ scope }) {
      const groups = groupByDepartment(await employments(scope));
      const rows = groups.map((g) => {
        const people = new Set(g.items.map((e) => e.personId));
        const row: Record<string, Cell> = {
          department: g.name,
          total: people.size,
          male: new Set(g.items.filter((e) => e.person.gender === "MALE").map((e) => e.personId)).size,
          female: new Set(g.items.filter((e) => e.person.gender === "FEMALE").map((e) => e.personId)).size,
          units: round2(g.items.reduce((s, e) => s + Number(e.unitShare), 0)),
        };
        for (const c of CATEGORIES) row[c] = g.items.filter((e) => e.position.staffCategory === c).length;
        return row;
      });
      const totals: Record<string, Cell> = { department: "Cəmi" };
      for (const k of ["total", "male", "female", "units", ...CATEGORIES]) totals[k] = round2(sum(rows, k));
      return {
        columns: [
          { key: "department", header: "Struktur bölmə", width: 36 },
          { key: "total", header: "Cəmi", type: "number" },
          { key: "male", header: "Kişi", type: "number" },
          { key: "female", header: "Qadın", type: "number" },
          ...CATEGORIES.map((c) => ({ key: c, header: STAFF_CATEGORY_LABELS[c], type: "number" as const, width: 16 })),
          { key: "units", header: "Ştat vahidi", type: "number" },
        ],
        rows,
        totals,
        note: "Bir neçə müqaviləsi olan şəxs hər bölmədə bir dəfə sayılır; kateqoriyalar müqavilə sayı ilədir.",
      };
    },
  },
  {
    key: "payroll",
    title: "Əməkhaqqı fondu",
    description: "Bölmələr üzrə aylıq oklad cəmi, brutto, netto və işəgötürən xərci (təxmini)",
    params: [],
    async run({ scope, hidden }) {
      const list = await employments(scope);
      // Güzəşt/əlavələrin bölgüsü bütün müqavilələrdən; məxfi maaşlar isə HEÇ BİR cəmə (bölmə və ümumi) daxil edilmir —
      // ümumi cəmdən bölmələri çıxmaqla fərdi maaş hesablana bilməsin
      const primary = primaryEmploymentIds(list);
      const excluded = list.filter((e) => hidden.has(e.personId)).length;
      // Oklad məlum deyil (null — miqrasiya): 0 kimi sayılmır, cəmlərə daxil edilmir, qeyddə ayrıca göstərilir
      const unknown = list.filter((e) => !hidden.has(e.personId) && e.baseSalary === null).length;
      const groups = groupByDepartment(list.filter((e) => !hidden.has(e.personId) && e.baseSalary !== null));
      const rows = groups.map((g) => {
        const p = g.items.map((e) => payrollOf(e, primary));
        return {
          department: g.name,
          count: g.items.length,
          base: round2(g.items.reduce((s, e) => s + Number(e.baseSalary), 0)),
          gross: round2(p.reduce((s, x) => s + x.gross, 0)),
          net: round2(p.reduce((s, x) => s + x.net, 0)),
          employer: round2(p.reduce((s, x) => s + x.employerCost, 0)),
        };
      });
      const totals: Record<string, Cell> = { department: "Cəmi" };
      for (const k of ["count", "base", "gross", "net", "employer"]) totals[k] = round2(sum(rows, k));
      return {
        columns: [
          { key: "department", header: "Struktur bölmə", width: 36 },
          { key: "count", header: "Müqavilə", type: "number" },
          { key: "base", header: "Oklad cəmi", type: "money", width: 16 },
          { key: "gross", header: "Brutto", type: "money", width: 16 },
          { key: "net", header: "Netto", type: "money", width: 16 },
          { key: "employer", header: "İşəgötürən xərci", type: "money", width: 18 },
        ],
        rows,
        totals,
        note:
          "Brutto/netto əlavələr, vergi və sosial ayırmalar sistemdəki əməkhaqqı qaydaları ilə hesablanır — təxmini göstəricidir. Vergi güzəştləri və elmi dərəcə/ad əlavələri şəxsə bir dəfə (əsas iş yerində, ştat payına mütənasib) tətbiq olunur; əvəzçilikdə yalnız oklad." +
          (excluded ? ` ${SALARY_EXCLUDED_NOTE}: ${excluded} müqavilə hesabata (say daxil) əlavə edilməyib.` : "") +
          (unknown ? ` ${SALARY_UNKNOWN_NOTE}: ${unknown} müqavilə (oklad boşdur) cəmlərə daxil edilməyib.` : ""),
      };
    },
  },
  {
    key: "roster",
    title: "Əməkdaşların siyahısı",
    description: "Bölmələr üzrə tam siyahı: vəzifə, heyət, işə qəbul tarixi, oklad",
    params: ["status"],
    async run({ scope, hidden }, params) {
      const list = await employments(scope, params.status === "all" ? {} : { status: { not: "TERMINATED" } });
      const STATUS = { ACTIVE: "Aktiv", ON_LEAVE: "Məzuniyyətdə", TERMINATED: "Azad olunub" } as const;
      const rows = list.map((e, i) => ({
        n: i + 1,
        code: e.person.code,
        name: e.person.fullName,
        department: e.department.name,
        position: e.position.name,
        category: STAFF_CATEGORY_LABELS[e.position.staffCategory],
        hireDate: e.hireDate ? formatAzDate(e.hireDate) : UNKNOWN_LABEL,
        unitShare: Number(e.unitShare),
        // Məxfi maaş: rəqəm yox, «Məxfi»; məlum deyil — «Məlum deyil» (hər ikisi cəmə daxil edilmir)
        salary: hidden.has(e.personId) ? SALARY_HIDDEN_LABEL : e.baseSalary === null ? UNKNOWN_LABEL : Number(e.baseSalary),
        status: STATUS[e.status],
      }));
      const excluded = list.filter((e) => hidden.has(e.personId)).length;
      const unknown = list.filter((e) => !hidden.has(e.personId) && e.baseSalary === null).length;
      const notes = [excluded ? `${SALARY_EXCLUDED_NOTE} (${excluded} müqavilə)` : "", unknown ? `${SALARY_UNKNOWN_NOTE}: ${unknown} müqavilə cəmə daxil deyil` : ""].filter(Boolean);
      return {
        columns: [
          { key: "n", header: "№", type: "number", width: 6 },
          { key: "code", header: "Kod", width: 10 },
          { key: "name", header: "Soyadı, adı, atasının adı", width: 32 },
          { key: "department", header: "Struktur bölmə", width: 28 },
          { key: "position", header: "Vəzifə", width: 26 },
          { key: "category", header: "Heyət", width: 18 },
          { key: "hireDate", header: "İşə qəbul", width: 12 },
          { key: "unitShare", header: "Ştat", type: "number" },
          { key: "salary", header: "Oklad", type: "money", width: 14 },
          { key: "status", header: "Status", width: 14 },
        ],
        rows,
        totals: { name: `Cəmi: ${rows.length}`, salary: round2(sum(rows, "salary")), unitShare: round2(sum(rows, "unitShare")) },
        ...(notes.length ? { note: notes.join(". ") } : {}),
      };
    },
  },
  {
    key: "movement",
    title: "Kadr hərəkəti",
    description: "Seçilmiş dövrdə işə qəbul, köçürmə, vəzifə artımı, maaş / ştat dəyişikliyi, ödənişsiz məzuniyyət və azad olunma",
    params: ["period", "kind"],
    async run({ scope, hidden }, params) {
      const now = new Date();
      const from = parseDay(params.from) ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const to = parseDay(params.to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const [list, moves, leaves] = await Promise.all([
        employments(scope, { OR: [{ hireDate: { gte: from, lte: to } }, { terminationDate: { gte: from, lte: to } }] }),
        // Köçürmə / oklad dəyişikliyi (dosyedəki forma, tam forma və struktur xəritəsi) — şöbə rəhbəri öz bölməsinə gələn və gedənləri görür
        prisma.employmentMovement.findMany({
          where: {
            effectiveDate: { gte: from, lte: to },
            employment: { person: { deletedAt: null } },
            ...(scope ? { OR: [{ employment: { departmentId: { in: scope } } }, { fromDepartmentId: { in: scope } }, { toDepartmentId: { in: scope } }] } : {}),
          },
          include: { employment: { select: { personId: true, department: { select: { name: true } }, position: { select: { name: true } }, person: { select: { fullName: true, code: true } } } } },
        }),
        // Ödənişsiz məzuniyyət (ö/m, ö/sm) — başlama tarixi dövrə düşən, ləğv edilməmiş qeydlər (əmrli və idxaldan)
        prisma.absence.findMany({
          where: {
            type: { in: ["UNPAID", "SOCIAL_UNPAID"] },
            cancelledAt: null,
            startDate: { gte: from, lte: to },
            person: { deletedAt: null, employments: { some: { status: { not: "TERMINATED" }, ...(scope ? { departmentId: { in: scope } } : {}) } } },
          },
          include: {
            person: {
              select: {
                fullName: true,
                code: true,
                employments: {
                  where: { status: { not: "TERMINATED" }, ...(scope ? { departmentId: { in: scope } } : {}) },
                  orderBy: [{ isPrimary: "desc" }, { hireDate: "asc" }],
                  take: 1,
                  select: { department: { select: { name: true } }, position: { select: { name: true } } },
                },
              },
            },
          },
        }),
      ]);
      type Event = { date: Date; code_: ReportEventKind; kind: string; name: string; code: string; department: string; position: string; details: string; order: string };
      const events: Event[] = list.flatMap((e) => [
        ...(e.hireDate && e.hireDate >= from && e.hireDate <= to
          ? [{ date: e.hireDate, code_: "HIRE" as const, kind: "İşə qəbul", name: e.person.fullName, code: e.person.code, department: e.department.name, position: e.position.name, details: "", order: "" }]
          : []),
        ...(e.terminationDate && e.terminationDate >= from && e.terminationDate <= to
          ? [
              {
                date: e.terminationDate,
                code_: "TERMINATION" as const,
                kind: "Azad olunma",
                name: e.person.fullName,
                code: e.person.code,
                department: e.department.name,
                position: e.position.name,
                details: e.terminationArticle ? `ƏM ${e.terminationArticle}` : "",
                order: "",
              },
            ]
          : []),
      ]);
      for (const m of moves) {
        // Məxfi maaş: «oklad X → Y» yerinə «oklad: məxfi»
        const diff = maskMovementSalary(
          {
            fromDepartment: m.fromDepartment,
            toDepartment: m.toDepartment,
            fromPosition: m.fromPosition,
            toPosition: m.toPosition,
            fromSalary: m.fromSalary === null ? null : Number(m.fromSalary),
            toSalary: m.toSalary === null ? null : Number(m.toSalary),
            fromUnitShare: m.fromUnitShare === null ? null : Number(m.fromUnitShare),
            toUnitShare: m.toUnitShare === null ? null : Number(m.toUnitShare),
          },
          hidden.has(m.employment.personId),
        );
        const { kind, details } = describeMovement(diff, m.kind);
        events.push({
          date: m.effectiveDate,
          code_: movementKindOf(diff, m.kind),
          kind,
          name: m.employment.person.fullName,
          code: m.employment.person.code,
          // Hərəkətdən sonrakı bölmə / vəzifə (sonradan yenə dəyişibsə, snapshot-dakı ad)
          department: m.toDepartment ?? m.employment.department.name,
          position: m.toPosition ?? m.employment.position.name,
          details,
          order: `№ ${m.orderNumber} · ${formatAzDate(m.orderDate)}`,
        });
      }
      for (const a of leaves) {
        const job = a.person.employments[0];
        events.push({
          date: a.startDate,
          code_: "UNPAID_LEAVE",
          kind: ORDER_LEAVE_LABELS[a.type as OrderLeaveType] ?? REPORT_EVENT_LABELS.UNPAID_LEAVE,
          name: a.person.fullName,
          code: a.person.code,
          department: job?.department.name ?? "",
          position: job?.position.name ?? "",
          details: `${formatAzDate(a.startDate)} – ${formatAzDate(a.endDate)} (${leaveDays(a.startDate, a.endDate)} gün)${a.note ? ` · ${a.note}` : ""}`,
          order: a.orderNumber ? `№ ${a.orderNumber}${a.orderDate ? ` · ${formatAzDate(a.orderDate)}` : ""}` : "idxal",
        });
      }
      const filtered = params.kind ? events.filter((e) => e.code_ === params.kind) : events;
      filtered.sort((a, b) => a.date.getTime() - b.date.getTime());
      const rows = filtered.map(({ code_: _c, ...e }) => ({ ...e, date: formatAzDate(e.date), details: e.details || null, order: e.order || null }));
      const count = (k: ReportEventKind) => filtered.filter((x) => x.code_ === k).length;
      const hires = count("HIRE");
      const exits = count("TERMINATION");
      const leaveCount = count("UNPAID_LEAVE");
      return {
        columns: [
          { key: "date", header: "Tarix", width: 12 },
          { key: "kind", header: "Növ", width: 22 },
          { key: "name", header: "Soyadı, adı, atasının adı", width: 32 },
          { key: "code", header: "Kod", width: 10 },
          { key: "department", header: "Struktur bölmə", width: 28 },
          { key: "position", header: "Vəzifə", width: 26 },
          { key: "details", header: "Dəyişiklik / maddə", width: 40 },
          { key: "order", header: "Əmr", width: 18 },
        ],
        rows,
        totals: { date: "Cəmi", kind: `qəbul ${hires} · hərəkət ${filtered.length - hires - exits - leaveCount} · məzuniyyət ${leaveCount} · azad ${exits}` },
        note: `Dövr: ${formatAzDate(from)} – ${formatAzDate(to)}${params.kind ? ` · növ: ${REPORT_EVENT_LABELS[params.kind]}` : ""}`,
      };
    },
  },
  {
    key: "academic",
    title: "Elmi potensial",
    description: "Bölmələr üzrə elmi dərəcə və elmi adı olan əməkdaşlar",
    params: [],
    async run({ scope }) {
      const groups = groupByDepartment(await employments(scope));
      const rows = groups.map((g) => {
        const people = [...new Map(g.items.map((e) => [e.personId, e.person])).values()];
        const has = (f: (p: (typeof people)[number]) => boolean) => people.filter(f).length;
        const dsc = has((p) => p.academicDegrees.some((d) => d.degree === "DSC"));
        const phd = has((p) => p.academicDegrees.some((d) => d.degree === "PHD") && !p.academicDegrees.some((d) => d.degree === "DSC"));
        return {
          department: g.name,
          total: people.length,
          dsc,
          phd,
          professor: has((p) => p.academicTitles.some((t) => t.title === "PROFESSOR")),
          docent: has((p) => p.academicTitles.some((t) => t.title === "DOCENT")),
          share: people.length ? round2(((dsc + phd) / people.length) * 100) : 0,
        };
      });
      const totals: Record<string, Cell> = { department: "Cəmi" };
      for (const k of ["total", "dsc", "phd", "professor", "docent"]) totals[k] = sum(rows, k);
      const t = totals.total as number;
      totals.share = t ? round2((((totals.dsc as number) + (totals.phd as number)) / t) * 100) : 0;
      return {
        columns: [
          { key: "department", header: "Struktur bölmə", width: 36 },
          { key: "total", header: "Əməkdaş", type: "number" },
          { key: "dsc", header: "Elmlər doktoru", type: "number", width: 14 },
          { key: "phd", header: "Fəlsəfə doktoru", type: "number", width: 14 },
          { key: "professor", header: "Professor", type: "number" },
          { key: "docent", header: "Dosent", type: "number" },
          { key: "share", header: "Elmi dərəcəlilər, %", type: "number", width: 16 },
        ],
        rows,
        totals,
      };
    },
  },
];

export const getReport = (key: string | undefined) => REPORTS.find((r) => r.key === key);

export function readReportParams(sp: URLSearchParams | Record<string, string | undefined>): ReportParams {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : sp[k]);
  const kind = get("kind");
  return { from: get("from"), to: get("to"), status: get("status") === "all" ? "all" : "active", kind: isReportEventKind(kind) ? kind : undefined };
}
