import "server-only";
import type { Prisma, StaffCategory } from "@prisma/client";
import { computePayroll } from "./calc/payroll";
import { prisma } from "./db";
import { STAFF_CATEGORY_LABELS } from "./queries";
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
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  params: ("period" | "status")[];
  run: (scope: string[] | null, params: ReportParams) => Promise<ReportResult>;
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

function payrollOf(e: Emp) {
  return computePayroll({
    baseSalary: Number(e.baseSalary),
    degrees: e.person.academicDegrees.map((d) => d.degree),
    titles: e.person.academicTitles.map((t) => t.title),
    hazardousAllowancePct: e.position.hazardousAllowancePct === null ? null : Number(e.position.hazardousAllowancePct),
    taxExemptionClause: e.person.taxExemptionClause,
  });
}

const parseDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : undefined);

export const REPORTS: ReportDef[] = [
  {
    key: "headcount",
    title: "Struktur bölmələri üzrə say",
    description: "Hər bölmədə əməkdaş sayı — cins və heyət kateqoriyası üzrə",
    params: [],
    async run(scope) {
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
    async run(scope) {
      const groups = groupByDepartment(await employments(scope));
      const rows = groups.map((g) => {
        const p = g.items.map(payrollOf);
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
        note: "Brutto/netto əlavələr, vergi və sosial ayırmalar sistemdəki əməkhaqqı qaydaları ilə hesablanır — təxmini göstəricidir.",
      };
    },
  },
  {
    key: "roster",
    title: "Əməkdaşların siyahısı",
    description: "Bölmələr üzrə tam siyahı: vəzifə, heyət, işə qəbul tarixi, oklad",
    params: ["status"],
    async run(scope, params) {
      const list = await employments(scope, params.status === "all" ? {} : { status: { not: "TERMINATED" } });
      const STATUS = { ACTIVE: "Aktiv", ON_LEAVE: "Məzuniyyətdə", TERMINATED: "Azad olunub" } as const;
      const rows = list.map((e, i) => ({
        n: i + 1,
        code: e.person.code,
        name: e.person.fullName,
        department: e.department.name,
        position: e.position.name,
        category: STAFF_CATEGORY_LABELS[e.position.staffCategory],
        hireDate: formatAzDate(e.hireDate),
        unitShare: Number(e.unitShare),
        salary: Number(e.baseSalary),
        status: STATUS[e.status],
      }));
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
      };
    },
  },
  {
    key: "movement",
    title: "İşə qəbul və azadolma",
    description: "Seçilmiş dövrdə işə qəbul edilən və işdən azad olunan əməkdaşlar",
    params: ["period"],
    async run(scope, params) {
      const now = new Date();
      const from = parseDay(params.from) ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const to = parseDay(params.to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const list = await employments(scope, { OR: [{ hireDate: { gte: from, lte: to } }, { terminationDate: { gte: from, lte: to } }] });
      const events = list.flatMap((e) => [
        ...(e.hireDate >= from && e.hireDate <= to ? [{ e, kind: "İşə qəbul", date: e.hireDate, article: "" }] : []),
        ...(e.terminationDate && e.terminationDate >= from && e.terminationDate <= to ? [{ e, kind: "Azad olunma", date: e.terminationDate, article: e.terminationArticle ?? "" }] : []),
      ]);
      events.sort((a, b) => a.date.getTime() - b.date.getTime());
      const rows = events.map(({ e, kind, date, article }) => ({
        date: formatAzDate(date),
        kind,
        name: e.person.fullName,
        code: e.person.code,
        department: e.department.name,
        position: e.position.name,
        article: article ? `ƏM ${article}` : null,
      }));
      const hires = events.filter((x) => x.kind === "İşə qəbul").length;
      return {
        columns: [
          { key: "date", header: "Tarix", width: 12 },
          { key: "kind", header: "Hərəkət", width: 14 },
          { key: "name", header: "Soyadı, adı, atasının adı", width: 32 },
          { key: "code", header: "Kod", width: 10 },
          { key: "department", header: "Struktur bölmə", width: 28 },
          { key: "position", header: "Vəzifə", width: 26 },
          { key: "article", header: "Maddə", width: 10 },
        ],
        rows,
        totals: { date: "Cəmi", kind: `qəbul ${hires} · azad ${events.length - hires}` },
        note: `Dövr: ${formatAzDate(from)} – ${formatAzDate(to)}`,
      };
    },
  },
  {
    key: "academic",
    title: "Elmi potensial",
    description: "Bölmələr üzrə elmi dərəcə və elmi adı olan əməkdaşlar",
    params: [],
    async run(scope) {
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
  return { from: get("from"), to: get("to"), status: get("status") === "all" ? "all" : "active" };
}
