import { z } from "zod";
import { DEFAULT_PAYROLL_CONFIG } from "../calc/payroll";
import {
  code,
  enumFrom,
  finCode,
  flag,
  formatAzDate,
  fullYearEnd,
  normalizeKey,
  optDate,
  optEmail,
  optNumber,
  optText,
  optYearOrDate,
  reqDate,
  reqNumber,
  reqText,
  sameDay,
  seniorityPart,
} from "./primitives";
import type { ColumnDef, FieldIssue, RefContext, SheetDef, SheetKey, TemplateDef, TemplateKey } from "./types";

/*
 * Şablon tərifləri "Kadr məlumatlarının yüklənməsi üçün şablonlar — əməkhaqqı üçün yenilənmiş 29.09.2025"
 * paketinə və "Şablonların doldurulması üzrə təlimat" sənədinə uyğundur.
 * Sütun başlıqları şablonlardakı kimidir; `aliases` əl ilə dəyişdirilmiş variantlar üçündür.
 */

// ============================================================================
//  Tarix sabitləri (təlimat)
// ============================================================================

/** "Tarixə" tipli şablonlar bu tarixə yığılır */
export const SNAPSHOT_DATE = new Date(Date.UTC(2025, 5, 30)); // 30.06.2025
/** "Dövr ərzində" tipli şablonlar (9, 10) */
export const MOVEMENT_PERIOD = { start: new Date(Date.UTC(2024, 6, 1)), end: new Date(Date.UTC(2025, 5, 30)) };
/** Məzuniyyət qalıqları bu tarixə yığılır; natamam iş illəri yüklənmir */
export const LEAVE_BALANCE_AS_OF = new Date(Date.UTC(2025, 3, 1)); // 01.04.2025

// ============================================================================
//  Köməkçilər
// ============================================================================

const err = (field: string, tier: FieldIssue["tier"], message: string, suggestion?: string): FieldIssue => ({
  field,
  tier,
  severity: "error",
  message,
  suggestion,
});
const warn = (field: string, tier: FieldIssue["tier"], message: string, suggestion?: string): FieldIssue => ({
  field,
  tier,
  severity: "warning",
  message,
  suggestion,
});

const MIN_WORK_AGE = 15; // AR ƏM, maddə 42

function addYears(d: Date, years: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()));
}

/** Xarici açar: DB-də, ya da batch-da etibarlı sətir kimi mövcud olmalıdır */
function requireKey<T>(map: Map<string, T>, ctx: RefContext, sheet: string, field: string, label: string, value: string): FieldIssue | null {
  if (map.has(value)) return null;
  const badRow = ctx.invalidKeys.get(`${sheet}:${value}`);
  if (badRow !== undefined) {
    return err(field, "reference", `${label} "${value}" idxal faylında var, lakin həmin sətir (№${badRow}) xətalıdır — əvvəlcə onu düzəldin`);
  }
  return err(field, "reference", `${label} "${value}" tapılmadı`);
}

function personRef(ctx: RefContext, personCode: string): FieldIssue[] {
  const issue = requireKey(ctx.persons, ctx, "persons", "personCode", "Əməkdaş kodu", personCode);
  return issue ? [issue] : [];
}

function primaryHireDate(ctx: RefContext, personCode: string): Date | null {
  const list = ctx.employments.get(personCode);
  if (!list || list.length === 0) return null;
  return list.reduce((min, e) => (e.hireDate < min ? e.hireDate : min), list[0]!.hireDate);
}

function dateOrder(start: Date | undefined, end: Date | undefined, endField: string, label = "Bitmə tarixi"): FieldIssue[] {
  if (start && end && end < start) return [err(endField, "semantic", `${label} başlama tarixindən əvvəl ola bilməz`)];
  return [];
}

function notFuture(d: Date | undefined, field: string, label: string): FieldIssue[] {
  return d && d > new Date() ? [err(field, "semantic", `${label} gələcəkdə ola bilməz`)] : [];
}

function inMovementPeriod(d: Date, field: string): FieldIssue[] {
  if (d >= MOVEMENT_PERIOD.start && d <= MOVEMENT_PERIOD.end) return [];
  return [warn(field, "semantic", `Tarix şablonun dövründən (${formatAzDate(MOVEMENT_PERIOD.start)} – ${formatAzDate(MOVEMENT_PERIOD.end)}) kənardadır`)];
}

/** Sənəddaxili təkrar: eyni açar başqa sətirdə görülübsə xəta */
function unique(ctx: RefContext, key: string, row: number, field: string, message: (prev: number) => string): FieldIssue[] {
  const prev = ctx.seen.get(key);
  if (prev !== undefined && prev !== row) return [err(field, "semantic", message(prev))];
  ctx.seen.set(key, row);
  return [];
}

const personCode = code("Əməkdaşın kodu");
const PERSON_COL: ColumnDef = { key: "personCode", header: "Əməkdaşın kodu", aliases: ["Əməkdaş kodu", "Tabel nömrəsi", "Cədvəl nömrəsi"], required: true, width: 120 };

const proficiency = (label: string) =>
  enumFrom(label, { əla: "EXCELLENT", yaxşı: "GOOD", kafi: "SATISFACTORY" } as const);

// ============================================================================
//  5 Struktur bölmələri.xlsx — 4 vərəq, səviyyə vərəqdən gəlir — Mərhələ 1
// ============================================================================

export const DEPARTMENT_SHEETS = ["departments1", "departments2", "departments3", "departments4"] as const;
export const isDepartmentSheet = (k: string): k is (typeof DEPARTMENT_SHEETS)[number] => (DEPARTMENT_SHEETS as readonly string[]).includes(k);
export const departmentLevel = (k: string): number => DEPARTMENT_SHEETS.indexOf(k as (typeof DEPARTMENT_SHEETS)[number]) + 1;

const ORDINAL = ["", "1-ci", "2-ci", "3-cü", "4-cü"];

function departmentSheet(level: 1 | 2 | 3 | 4) {
  const schema = z
    .object({
      code: code("Kod"),
      name: reqText("Ad"),
      parentCode: level === 1 ? z.unknown().transform((): string | undefined => undefined) : code("Tabe olduğu struktur bölmənin kodu"),
      isFaculty: flag("Fakultə"),
      isChair: flag("Kafedra"),
      createdOn: reqDate("Bölmənin yaradılma tarixi"),
      closedOn: optDate("Bölmənin bağlanma tarixi"),
    })
    .transform((r) => ({ ...r, level }));

  const columns: ColumnDef[] = [
    { key: "code", header: "Kod", aliases: ["Bölmənin kodu"], required: true },
    { key: "name", header: "Ad", aliases: ["Bölmənin adı"], required: true, width: 260 },
    ...(level > 1 ? [{ key: "parentCode", header: "Tabe olduğu struktur bölmənin kodu", aliases: ["Üst bölmənin kodu"], required: true }] : []),
    { key: "isFaculty", header: "Fakultə (Bəli/Xeyr)", aliases: ["Fakültə (Bəli/Xeyr)", "Fakultə", "Fakültə"] },
    { key: "isChair", header: "Kafedra (Bəli/Xeyr)", aliases: ["Kafedra"] },
    { key: "createdOn", header: "Bölmənin yaradılma tarixi", aliases: ["Yaradılma tarixi"], required: true },
    { key: "closedOn", header: "Bölmənin bağlanma tarixi", aliases: ["Bağlanma tarixi"] },
  ];

  const def: SheetDef<typeof schema> = {
    key: DEPARTMENT_SHEETS[level - 1]!,
    templateKey: "departments",
    sheetNames: [`${ORDINAL[level]} mərhələ struktur bölmələri`, `${level}-ci mərhələ struktur bölmələri`],
    stage: "S1_DEPARTMENTS",
    title: `${ORDINAL[level]} mərhələ bölmələr`,
    columns,
    schema,
    semantic: (r) => {
      const out: FieldIssue[] = [];
      if (r.parentCode === r.code) out.push(err("parentCode", "semantic", "Bölmə özünə tabe ola bilməz"));
      if (r.isFaculty && r.isChair) out.push(err("isChair", "semantic", "Bölmə eyni zamanda həm fakultə, həm kafedra ola bilməz"));
      if (r.isChair && level === 1) out.push(warn("isChair", "semantic", "Kafedra adətən fakultənin tabeliyində olur (2-ci və aşağı mərhələ)"));
      out.push(...dateOrder(r.createdOn, r.closedOn, "closedOn", "Bağlanma tarixi"));
      return out;
    },
    references: (r, ctx, row) => {
      const out = unique(ctx, `dept:${r.code}`, row, "code", (p) => `Bölmə kodu №${p} sətirdə (və ya başqa mərhələ vərəqində) təkrarlanır`);
      if (!r.parentCode) return out;
      const issue = requireKey(ctx.departments, ctx, "departments", "parentCode", "Tabe olduğu bölmə", r.parentCode);
      if (issue) return [...out, issue];
      const parent = ctx.departments.get(r.parentCode)!;
      if (parent.level !== level - 1)
        out.push(
          err(
            "parentCode",
            "reference",
            `Tabe olduğu bölmə ${ORDINAL[parent.level]} mərhələdədir; ${ORDINAL[level]} mərhələ bölməsi ${ORDINAL[level - 1]} mərhələ bölməsinə tabe olmalıdır`,
          ),
        );
      if (r.createdOn < parent.createdOn) out.push(warn("createdOn", "reference", "Bölmə tabe olduğu bölmədən əvvəl yaradılıb"));
      if (parent.closedOn && !r.closedOn) out.push(warn("closedOn", "reference", `Tabe olduğu bölmə ${formatAzDate(parent.closedOn)} tarixində bağlanıb`));
      return out;
    },
  };
  return def;
}

const departments1 = departmentSheet(1);
const departments2 = departmentSheet(2);
const departments3 = departmentSheet(3);
const departments4 = departmentSheet(4);

// ============================================================================
//  1 Kadr Cədvəlləri.xlsx → Vəzifələr — Mərhələ 2
// ============================================================================

const STANDARD_BASIC_LEAVE = [21, 30, 42, 48, 56];

const positionSchema = z.object({
  code: code("Vəzifənin kodu"),
  name: reqText("Vəzifənin adı"),
  category: enumFrom("Statistik hesabın kateqoriyası", { qulluqçu: "QULLUQCU", fəhlə: "FEHLE" } as const),
  basicLeaveDays: reqNumber("Əsas məzuniyyət günləri sayı", { min: 1, max: 60, int: true }),
  // Təlimatda "bəli/xeyr" də deyilir — "xeyr"/boş = 0
  hazardousLeaveDays: z
    .preprocess((v) => (v === undefined || (typeof v === "string" && ["", "xeyr", "yox", "-"].includes(v.trim().toLocaleLowerCase("az"))) ? "0" : v), z.string())
    .transform((v, ctx) => {
      const n = Number(v.replace(",", "."));
      if (!Number.isInteger(n) || n < 0 || n > 30) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Zərərli şəraitə görə əlavə məzuniyyət günlərin sayı (0–30) kimi yazılmalıdır" });
        return z.NEVER;
      }
      return n;
    }),
  isPedagogical: flag("Pedoqoji heyət"),
  isScientific: flag("Elmi staj"),
  isScientificPedagogical: flag("Elmi-pedoqoji staj"),
  staffCategory: enumFrom("Heyət", {
    inzibati: "INZIBATI",
    "professor-müəllim": "PROFESSOR_MUELLIM",
    "tədris-köməkçi": "TEDRIS_KOMEKCI",
    xidmətedici: "XIDMETEDICI",
  } as const),
  isAdministrativeManagement: flag("İnzibati idarəetmə personalı"),
  hazardousAllowancePct: optNumber("Zərərli şəraitə görə əlavə (%)", { min: 0, max: 100 }),
  validFrom: reqDate("Vəzifənin yaradılma tarixi"),
  validTo: optDate("Vəzifənin bağlanma tarixi"),
});

const positions: SheetDef<typeof positionSchema> = {
  key: "positions",
  templateKey: "kadr",
  sheetNames: ["Vəzifələr"],
  stage: "S2_POSITIONS",
  title: "Vəzifələr",
  columns: [
    { key: "code", header: "Vəzifənin kodu", aliases: ["Vəzifə kodu"], required: true },
    { key: "name", header: "Vəzifənin adı", required: true, width: 240 },
    { key: "category", header: "Statistik hesabın kateqoriyası (qulluqçu/fəhlə)", aliases: ["Kateqoriya"], required: true },
    { key: "basicLeaveDays", header: "Əsas məzuniyyət günləri sayı", aliases: ["Əsas məzuniyyət günləri"], required: true },
    {
      key: "hazardousLeaveDays",
      header: "Əməyin zərərli şəraitinə görə əlavə məzuniyyət günlərinin miqdarı",
      aliases: ["Əməyin zərərli şəraitinə görə əlavə məzuniyyət (bəli/xeyr) günlərinin miqdarı"],
    },
    { key: "isPedagogical", header: "Pedoqoji heyət (bəli/xeyr)", aliases: ["Pedaqoji heyət (bəli/xeyr)"] },
    { key: "isScientific", header: "Elmi staj (bəli/xeyr)" },
    { key: "isScientificPedagogical", header: "Elmi-pedoqoji staj (bəli/xeyr)", aliases: ["Elmi-pedaqoji staj (bəli/xeyr)", "Elmi-pedoqoji heyət (bəli/xeyr)"] },
    { key: "staffCategory", header: "Heyət (İnzibati, Professor-müəllim, Tədris-köməkçi, Xidmətedici)", aliases: ["Heyət"], required: true },
    { key: "isAdministrativeManagement", header: "İnzibati idarəetmə personalı (bəli/xeyr)" },
    { key: "validFrom", header: "Vəzifənin yaradılma tarixi", required: true },
    { key: "validTo", header: "Vəzifənin bağlanma tarixi" },
  ],
  schema: positionSchema,
  semantic: (r) => {
    const out: FieldIssue[] = [];
    if (!STANDARD_BASIC_LEAVE.includes(r.basicLeaveDays))
      out.push(warn("basicLeaveDays", "semantic", `Əsas məzuniyyət adətən ${STANDARD_BASIC_LEAVE.join(" / ")} gün olur`));
    if (r.category === "FEHLE" && r.staffCategory === "PROFESSOR_MUELLIM")
      out.push(err("category", "semantic", "Professor-müəllim heyəti vəzifəsi 'fəhlə' kateqoriyasında ola bilməz"));
    out.push(...dateOrder(r.validFrom, r.validTo, "validTo", "Bağlanma tarixi"));
    return out;
  },
  references: (r, ctx, row) => {
    const out = unique(ctx, `pos:${r.code}`, row, "code", (p) => `Vəzifə kodu №${p} sətirdə təkrarlanır`);
    const nameKey = normalizeKey(r.name);
    out.push(...unique(ctx, `posname:${nameKey}`, row, "name", (p) => `Vəzifənin adı №${p} sətirdə təkrarlanır — adlar təkrarlana bilməz`));
    const owner = ctx.positionNames.get(nameKey);
    if (owner && owner !== r.code) out.push(err("name", "reference", `Bu ad artıq "${owner}" kodlu vəzifəyə aiddir`));
    return out;
  },
};

// ============================================================================
//  4 Ştat cədvəli.xlsx — Mərhələ 3
// ============================================================================

const staffingSchema = z.object({
  periodDate: reqDate("Dövr"),
  departmentCode: code("Təşkilat bölməsi (kodu)"),
  positionCode: code("Vəzifə (kodu)"),
  unitCount: reqNumber("Ştat vahidlərinin sayı", { min: 0.25, max: 999 }),
  minSalary: reqNumber("Minimal maaşı", { min: 0 }),
  maxSalary: reqNumber("Maksimal maaşı", { min: 0 }),
  salaryType: optText,
  schedule: reqText("İş rejimi/İş qrafiki"),
});

const staffing: SheetDef<typeof staffingSchema> = {
  key: "staffing",
  templateKey: "staffing",
  sheetNames: ["Ştat cədvəli"],
  stage: "S3_STAFFING",
  title: "Ştat cədvəli",
  columns: [
    { key: "periodDate", header: "Dövr", required: true },
    { key: "departmentCode", header: "Təşkilat bölməsi (kodu)", aliases: ["Bölmə (kodu)"], required: true },
    { key: "positionCode", header: "Vəzifə (kodu)", required: true },
    { key: "unitCount", header: "Ştat vahidlərinin sayı", aliases: ["Ştat vahidi"], required: true },
    { key: "minSalary", header: "Minimal maaşı", required: true },
    { key: "maxSalary", header: "Maksimal maaşı", required: true },
    { key: "salaryType", header: "Maaşın növü" },
    { key: "schedule", header: "İş rejimi/İş qrafiki", aliases: ["İş qrafiki", "İş rejimi"], required: true },
  ],
  schema: staffingSchema,
  semantic: (r) => {
    const out: FieldIssue[] = [];
    if (r.minSalary > r.maxSalary) out.push(err("maxSalary", "semantic", "Maksimal maaş minimaldan az ola bilməz (fərq yoxdursa, hər ikisinə eyni məbləği yazın)"));
    if (Math.round(r.unitCount * 4) !== r.unitCount * 4) out.push(warn("unitCount", "semantic", "Ştat vahidi adətən 0.25-in misli olur"));
    return out;
  },
  references: (r, ctx, row) => {
    const out: FieldIssue[] = [];
    const d = requireKey(ctx.departments, ctx, "departments", "departmentCode", "Bölmə", r.departmentCode);
    const p = requireKey(ctx.positions, ctx, "positions", "positionCode", "Vəzifə", r.positionCode);
    if (d) out.push(d);
    if (p) out.push(p);
    const dept = ctx.departments.get(r.departmentCode);
    if (dept?.closedOn && dept.closedOn <= r.periodDate) out.push(err("departmentCode", "reference", `Bölmə ${formatAzDate(dept.closedOn)} tarixində bağlanıb`));
    const pos = ctx.positions.get(r.positionCode);
    if (pos && (pos.validFrom > r.periodDate || (pos.validTo && pos.validTo < r.periodDate)))
      out.push(err("positionCode", "reference", "Vəzifə həmin dövrdə qüvvədə deyil (yaradılma/bağlanma tarixinə baxın)"));
    out.push(
      ...unique(
        ctx,
        `staffing:${formatAzDate(r.periodDate)}|${r.departmentCode}|${r.positionCode}`,
        row,
        "positionCode",
        (prev) => `Eyni dövr/bölmə/vəzifə №${prev} sətirdə artıq var`,
      ),
    );
    return out;
  },
};

// ============================================================================
//  1 Kadr Cədvəlləri.xlsx → Fiziki şəxslər (iki sətirli başlıq) — Mərhələ 4
// ============================================================================

const SENIORITY_GROUPS = [
  { prefix: "labor", group: "Əmək stajı", label: "Əmək stajı" },
  { prefix: "scientific", group: "Elmi stajı", label: "Elmi staj" },
  { prefix: "scientificPedagogical", group: "Elmi-pedoqoji stajı", label: "Elmi-pedaqoji staj" },
  // Köhnə şablonlarda "UNEC-də stajı" — alias kimi tanınır
  { prefix: "unec", group: "ASOİU-də stajı", label: "ASOİU stajı", groupAliases: ["UNEC-də stajı"] },
  { prefix: "insurance", group: "Sığorta stajı", label: "Sığorta stajı" },
] as const;

type SeniorityKey = `${(typeof SENIORITY_GROUPS)[number]["prefix"]}Seniority${"Years" | "Months" | "Days"}`;

const seniorityFields = Object.fromEntries(
  SENIORITY_GROUPS.flatMap(({ prefix, label }) => [
    [`${prefix}SeniorityYears`, seniorityPart(`${label} (illər)`, 70)],
    [`${prefix}SeniorityMonths`, seniorityPart(`${label} (aylar)`, 11)],
    [`${prefix}SeniorityDays`, seniorityPart(`${label} (günlər)`, 30)],
  ]),
) as Record<SeniorityKey, ReturnType<typeof seniorityPart>>;

const seniorityColumns: ColumnDef[] = SENIORITY_GROUPS.flatMap((g) => {
  const { prefix, group } = g;
  const groupAliases = "groupAliases" in g ? [...g.groupAliases] : undefined;
  return [
    { key: `${prefix}SeniorityYears`, group, groupAliases, header: "İllər", width: 70 },
    { key: `${prefix}SeniorityMonths`, group, groupAliases, header: "Aylar", width: 70 },
    { key: `${prefix}SeniorityDays`, group, groupAliases, header: "Günlər", width: 70 },
  ];
});

const KNOWN_TAX_CLAUSES = Object.keys(DEFAULT_PAYROLL_CONFIG.taxExemptions);

const personSchema = z.object({
  code: code("Əməkdaşın kodu"),
  lastName: reqText("Soyadı"),
  firstName: reqText("Adı"),
  patronymic: optText,
  gender: enumFrom("Cins (K/Q)", { k: "MALE", kişi: "MALE", q: "FEMALE", qadın: "FEMALE" } as const),
  birthDate: reqDate("Doğum tarixi"),
  maritalStatus: enumFrom(
    "Ailə vəziyyəti",
    { subay: "SINGLE", evli: "MARRIED", ailəli: "MARRIED", nikahda: "MARRIED", boşanmış: "DIVORCED", "nikahı pozulmuş": "DIVORCED", dul: "WIDOWED" } as const,
    false,
  ),
  mobilePhone: optText,
  workPhone: optText,
  email: optEmail,
  registeredAddress: optText,
  livingAddress: optText,
  ssn: optText,
  birthCountry: optText,
  birthDistrict: optText,
  birthCity: optText,
  idDocType: reqText("Sənədin növü"),
  idDocSeries: optText,
  idDocNumber: reqText("Nömrə"),
  idDocIssueDate: optDate("Verilmənin tarixi"),
  idDocIssuedBy: optText,
  fin: finCode,
  ...seniorityFields,
  taxExemptionClause: optText,
  citizenship: optText,
  nationality: optText,
  socialOrigin: optText,
  isForeigner: flag("Xarici fiziki şəxs"),
  arrivalDate: optDate("Gəlmə tarixi"),
  visaNumber: optText,
  visaIssueDate: optDate("Vizanın tarixi"),
  visaExpiryDate: optDate("Vizanın müddəti"),
  passportNumber: optText,
  passportIssueDate: optDate("Passportun verilmə tarixi"),
  passportExpiry: optDate("Passportun etibarlılıq müddəti"),
  isIdpOrRefugee: flag("Məcburi köçkün"),
  quotaBasicLeaveDays: optNumber("Kvota üzrə əsas məzuniyyət günlərinin miqdarı", { min: 1, max: 60, int: true }),
});

const persons: SheetDef<typeof personSchema> = {
  key: "persons",
  templateKey: "kadr",
  sheetNames: ["Fiziki şəxslər"],
  stage: "S4_PERSONS",
  title: "Fiziki şəxslər",
  columns: [
    { ...PERSON_COL, key: "code" },
    { key: "lastName", header: "Soyadı", required: true, width: 140 },
    { key: "firstName", header: "Adı", required: true, width: 120 },
    { key: "patronymic", header: "Atasının adı", aliases: ["Ata adı"], width: 120 },
    { key: "gender", header: "Cins (K/Q)", aliases: ["Cins", "Cinsi"], required: true, width: 80 },
    { key: "birthDate", header: "Doğum tarixi", required: true },
    { key: "maritalStatus", header: "Ailə vəziyyəti" },
    { key: "mobilePhone", header: "Mobil telefon" },
    { key: "workPhone", header: "Xidməti telefon" },
    { key: "email", header: "E-Mail", aliases: ["E-poçt", "Email"] },
    { key: "registeredAddress", header: "Fiziki şəxsin qeydiyyatı üzrə ünvan", aliases: ["Qeydiyyat ünvanı"], width: 220 },
    { key: "livingAddress", header: "Fiziki şəxsin yaşadığı ünvan", aliases: ["Yaşadığı ünvan"], width: 220 },
    { key: "ssn", header: "Sosial sığorta nömrəsi" },
    { key: "birthCountry", group: "Doğulduğu yer", header: "Ölkə" },
    { key: "birthDistrict", group: "Doğulduğu yer", header: "Rayon" },
    { key: "birthCity", group: "Doğulduğu yer", header: "Şəhər" },
    { key: "idDocType", group: "Şəxsiyyət vəsiqəsi", header: "Sənədin növü", required: true, width: 160 },
    { key: "idDocSeries", group: "Şəxsiyyət vəsiqəsi", header: "Seriya", width: 80 },
    { key: "idDocNumber", group: "Şəxsiyyət vəsiqəsi", header: "Nömrə", required: true },
    { key: "idDocIssueDate", group: "Şəxsiyyət vəsiqəsi", header: "Verilmənin tarixi" },
    { key: "idDocIssuedBy", group: "Şəxsiyyət vəsiqəsi", header: "Kim tərəfindən verilib", width: 200 },
    { key: "fin", group: "Şəxsiyyət vəsiqəsi", header: "FİN kod", aliases: ["FİN kod", "FİN"], required: true, width: 100 },
    ...seniorityColumns,
    { key: "taxExemptionClause", header: "Vergi güzəşti (maddəni göstərin)", aliases: ["Vergi güzəşti"] },
    { key: "citizenship", header: "Vətəndaşlıq" },
    { key: "nationality", header: "Milliyəti", aliases: ["Milliyyəti"] },
    { key: "socialOrigin", header: "İctimai mənşəyi" },
    { key: "isForeigner", header: "Xarici fiziki şəxs (Bəli/Xeyr)", aliases: ["Xarici fiziki şəxs (hə/yox)"] },
    { key: "arrivalDate", group: "Əgər xarici fiziki şəxsdirsə", header: "Gəlmə tarixi" },
    { key: "visaNumber", group: "Əgər xarici fiziki şəxsdirsə", header: "Vizanın nömrəsi" },
    { key: "visaIssueDate", group: "Əgər xarici fiziki şəxsdirsə", header: "Vizanın tarixi" },
    { key: "visaExpiryDate", group: "Əgər xarici fiziki şəxsdirsə", header: "Vizanın müddəti" },
    { key: "passportNumber", group: "Əgər xarici fiziki şəxsdirsə", header: "Passportun seriya və nömrəsi" },
    { key: "passportIssueDate", group: "Əgər xarici fiziki şəxsdirsə", header: "Passportun verilmə tarixi" },
    { key: "passportExpiry", group: "Əgər xarici fiziki şəxsdirsə", header: "Passportun etibarlılıq müddəti" },
    { key: "isIdpOrRefugee", header: "Məcburi köçkün (Bəli/Xeyr)", aliases: ["Məcburi köçkün (hə/yox)"] },
    { key: "quotaBasicLeaveDays", header: "Kvota üzrə əsas məzuniyyət günlərinin miqdarı" },
  ],
  schema: personSchema,
  semantic: (r) => {
    const out: FieldIssue[] = [];
    out.push(...notFuture(r.birthDate, "birthDate", "Doğum tarixi"));
    if (addYears(r.birthDate, MIN_WORK_AGE) > SNAPSHOT_DATE) out.push(err("birthDate", "semantic", `Əməkdaşın yaşı ${MIN_WORK_AGE}-dən az ola bilməz`));
    if (r.idDocIssueDate && r.idDocIssueDate < r.birthDate) out.push(err("idDocIssueDate", "semantic", "Sənəd doğum tarixindən əvvəl verilə bilməz"));
    out.push(...notFuture(r.idDocIssueDate, "idDocIssueDate", "Sənədin verilmə tarixi"));
    if (r.taxExemptionClause && !KNOWN_TAX_CLAUSES.includes(r.taxExemptionClause))
      out.push(
        warn(
          "taxExemptionClause",
          "semantic",
          `Güzəşt "${r.taxExemptionClause}" əməkhaqqı konfiqurasiyasında yoxdur (${KNOWN_TAX_CLAUSES.join(", ")}) — hesablamada nəzərə alınmayacaq`,
        ),
      );
    if (r.isForeigner) {
      if (!r.passportNumber) out.push(err("passportNumber", "semantic", "Xarici fiziki şəxs üçün pasportun seriya və nömrəsi məcburidir"));
      out.push(...dateOrder(r.visaIssueDate, r.visaExpiryDate, "visaExpiryDate", "Vizanın müddəti"));
      out.push(...dateOrder(r.passportIssueDate, r.passportExpiry, "passportExpiry", "Pasportun etibarlılıq müddəti"));
    } else if (r.visaNumber || r.passportNumber || r.arrivalDate) {
      out.push(warn("isForeigner", "semantic", 'Əcnəbi sahələri doldurulub, lakin "Xarici fiziki şəxs" = Xeyr'));
    }
    return out;
  },
  references: (r, ctx, row) => {
    const out: FieldIssue[] = [
      ...unique(ctx, `person:${r.code}`, row, "code", (p) => `Əməkdaşın kodu №${p} sətirdə təkrarlanır`),
      ...unique(ctx, `fin:${r.fin}`, row, "fin", (p) => `FİN kod №${p} sətirdə təkrarlanır`),
      ...(r.ssn ? unique(ctx, `ssn:${r.ssn}`, row, "ssn", (p) => `Sosial sığorta nömrəsi №${p} sətirdə təkrarlanır`) : []),
    ];
    const finOwner = ctx.finOwners.get(r.fin);
    if (finOwner && finOwner !== r.code) out.push(err("fin", "reference", `FİN kod artıq ${finOwner} kodlu əməkdaşa aiddir`));
    const ssnOwner = r.ssn ? ctx.ssnOwners.get(r.ssn) : undefined;
    if (ssnOwner && ssnOwner !== r.code) out.push(err("ssn", "reference", `Sosial sığorta nömrəsi artıq ${ssnOwner} kodlu əməkdaşa aiddir`));
    return out;
  },
};

// ============================================================================
//  1 Kadr Cədvəlləri.xlsx → Əməkdaşlar — Mərhələ 5
// ============================================================================

const employmentSchema = z.object({
  personCode,
  positionCode: code("Vəzifə (kodu)"),
  departmentCode: code("Bölmə/şöbə (kodu)"),
  hireDate: reqDate("Qəbul tarixi"),
  schedule: reqText("İş qrafiki"),
  paymentForm: reqText("Ödəniş forması"),
  baseSalary: reqNumber("Oklad", { min: 0 }),
  /** Şablonda yoxdur; sütun əlavə edilərsə kəsr ştatlar dəqiq yoxlanılır */
  unitShare: optNumber("Ştat vahidi", { min: 0.1, max: 1.5 }),
});

const employments: SheetDef<typeof employmentSchema> = {
  key: "employments",
  templateKey: "kadr",
  sheetNames: ["Əməkdaşlar"],
  stage: "S5_EMPLOYMENTS",
  title: "Əməkdaşlar",
  columns: [
    PERSON_COL,
    { key: "positionCode", header: "Vəzifə (kodu)", aliases: ["Vəzifə"], required: true },
    { key: "departmentCode", header: "Bölmə/şöbə (kodu)", aliases: ["Bölmə/şöbə", "Bölmə (kodu)"], required: true },
    { key: "hireDate", header: "Qəbul tarixi", aliases: ["İşə qəbul tarixi"], required: true },
    { key: "schedule", header: "İş qrafiki", aliases: ["İş rejimi və iş qrafiki", "İş rejimi/İş qrafiki"], required: true },
    { key: "paymentForm", header: "Ödəniş forması", required: true },
    { key: "baseSalary", header: "Oklad", aliases: ["Vəzifə maaşı"], required: true },
    { key: "unitShare", header: "Ştat vahidi", aliases: ["Stavka"] },
  ],
  schema: employmentSchema,
  semantic: (r) => (r.hireDate > SNAPSHOT_DATE ? [warn("hireDate", "semantic", `Qəbul tarixi şablonun tarixindən (${formatAzDate(SNAPSHOT_DATE)}) sonradır`)] : []),
  references: (r, ctx, row) => {
    const out: FieldIssue[] = [...personRef(ctx, r.personCode)];
    const d = requireKey(ctx.departments, ctx, "departments", "departmentCode", "Bölmə", r.departmentCode);
    const p = requireKey(ctx.positions, ctx, "positions", "positionCode", "Vəzifə", r.positionCode);
    if (d) out.push(d);
    if (p) out.push(p);

    const person = ctx.persons.get(r.personCode);
    if (person && addYears(person.birthDate, MIN_WORK_AGE) > r.hireDate)
      out.push(err("hireDate", "reference", `Qəbul tarixində əməkdaşın yaşı ${MIN_WORK_AGE}-dən az olub`));

    const pos = ctx.positions.get(r.positionCode);
    if (pos && (pos.validFrom > r.hireDate || (pos.validTo && pos.validTo < r.hireDate)))
      out.push(warn("positionCode", "reference", "Vəzifə qəbul tarixində qüvvədə olmayıb (yaradılma/bağlanma tarixinə baxın)"));
    if (pos?.validTo && pos.validTo <= SNAPSHOT_DATE) out.push(err("positionCode", "reference", `Vəzifə ${formatAzDate(pos.validTo)} tarixində bağlanıb`));

    const dept = ctx.departments.get(r.departmentCode);
    if (dept?.closedOn && dept.closedOn <= SNAPSHOT_DATE) out.push(err("departmentCode", "reference", `Bölmə ${formatAzDate(dept.closedOn)} tarixində bağlanıb`));

    const key = `${r.departmentCode}|${r.positionCode}`;
    const unit = ctx.staffing.get(key);
    if (dept && pos) {
      if (!unit) {
        out.push(err("positionCode", "reference", `Ştat cədvəlində ${r.departmentCode} bölməsində ${r.positionCode} vəzifəsi üçün ştat vahidi yoxdur`));
      } else {
        // Şablonda əməkdaşın tutduğu ştat payı yoxdur: hər əməkdaş 1 yer tutur, kəsr ştat yuxarı yuvarlaqlaşdırılır (2.5 → 3 nəfər)
        const exact = r.unitShare !== undefined;
        const limit = exact ? unit.unitCount : Math.ceil(unit.unitCount - 1e-9);
        const used = (ctx.staffingUsage.get(key) ?? 0) + (r.unitShare ?? 1);
        if (used > limit + 1e-9)
          out.push(err("positionCode", "reference", `Ştat limiti aşılır: ${used} / ${unit.unitCount} ştat vahidi (${r.departmentCode} · ${r.positionCode})`));
        else ctx.staffingUsage.set(key, used);
        if (r.baseSalary < unit.minSalary || r.baseSalary > unit.maxSalary)
          out.push(warn("baseSalary", "reference", `Oklad ştat diapazonundan kənardır (${unit.minSalary}–${unit.maxSalary} AZN)`));
      }
    }
    out.push(
      ...unique(
        ctx,
        `emp:${r.personCode}|${r.positionCode}|${r.departmentCode}|${formatAzDate(r.hireDate)}`,
        row,
        "personCode",
        (prev) => `Eyni təyinat №${prev} sətirdə təkrarlanır`,
      ),
    );
    return out;
  },
};

// ============================================================================
//  1 Kadr Cədvəlləri.xlsx → Əmək fəaliyyəti / Hərbi uçot / Əlillik — Mərhələ 6
// ============================================================================

const workHistorySchema = z.object({
  personCode,
  organization: reqText("Əvvəlki iş yerinin adı"),
  position: reqText("Əvvəlki iş yerində vəzifəsi"),
  countsScientific: flag("Elmi staj"),
  countsScientificPedagog: flag("Elmi-pedoqoji staj"),
  countsUnec: flag("ASOİU-də staj"),
  startDate: reqDate("İşə qəbul tarixi"),
  endDate: optDate("İşdən azad olunma tarixi"),
  terminationReason: optText,
  laborCodeArticle: optText,
});

const workHistory: SheetDef<typeof workHistorySchema> = {
  key: "workHistory",
  templateKey: "kadr",
  sheetNames: ["Əmək fəaliyyəti"],
  stage: "S6_PROFILES",
  title: "Əmək fəaliyyəti",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "organization", header: "Əvvəlki iş yerinin adı", required: true, width: 220 },
    { key: "position", header: "Əvvəlki iş yerində vəzifəsi", required: true, width: 180 },
    { key: "countsScientific", header: "Elmi staj (bəli/xeyr)" },
    { key: "countsScientificPedagog", header: "Elmi-pedoqoji staj (bəli/xeyr)", aliases: ["Elmi-pedaqoji staj (bəli/xeyr)"] },
    { key: "countsUnec", header: "ASOİU-də staj (bəli/xeyr)", aliases: ["UNEC-də staj (bəli/xeyr)"] },
    { key: "startDate", header: "İşə qəbul tarixi", required: true },
    { key: "endDate", header: "İşdən azad olunma tarixi" },
    { key: "terminationReason", header: "İşdən azad olunma səbəbi" },
    { key: "laborCodeArticle", header: "İşdən azad olunma maddəsi" },
  ],
  schema: workHistorySchema,
  semantic: (r) => {
    const out = dateOrder(r.startDate, r.endDate, "endDate", "İşdən azad olunma tarixi");
    if (r.endDate && !r.laborCodeArticle) out.push(warn("laborCodeArticle", "semantic", "İşdən azad olunma maddəsi göstərilməyib"));
    return out;
  },
  references: (r, ctx) => {
    const out = personRef(ctx, r.personCode);
    const p = ctx.persons.get(r.personCode);
    if (p && addYears(p.birthDate, MIN_WORK_AGE) > r.startDate) out.push(err("startDate", "reference", `İşə qəbul tarixində yaş ${MIN_WORK_AGE}-dən az olub`));
    return out;
  },
};

const militarySchema = z.object({
  personCode,
  obligation: reqText("Hərbi öhdəlik"),
  rank: optText,
  profile: optText,
  reserveCategory: optText,
  specialtyVus: optText,
  fitness: optText,
  draftBoard: optText,
  status: optText,
});

const military: SheetDef<typeof militarySchema> = {
  key: "military",
  templateKey: "kadr",
  sheetNames: ["Hərbi uçot məlumatları", "Hərbi uçot"],
  stage: "S6_PROFILES",
  title: "Hərbi uçot məlumatları",
  columns: [
    PERSON_COL,
    { key: "obligation", header: "Hərbi öhdəlik", aliases: ["Hərbi mükəlləfiyyət"], required: true },
    { key: "rank", header: "Hərbi rütbə" },
    { key: "profile", header: "Tərkib (profil)" },
    { key: "reserveCategory", header: "Ehtiyat tərkibi" },
    { key: "specialtyVus", header: "Hərbi qeydiyyat ixtisası" },
    { key: "fitness", header: "Hərbi xidmətə yararlılıq" },
    { key: "draftBoard", header: "Hərbi komissarlıq" },
    { key: "status", header: "Hərbi uçot durumu" },
  ],
  schema: militarySchema,
  references: (r, ctx, row) => [
    ...personRef(ctx, r.personCode),
    ...unique(ctx, `military:${r.personCode}`, row, "personCode", (p) => `Bu əməkdaşın hərbi uçot məlumatı №${p} sətirdə artıq var`),
  ],
};

const disabilitySchema = z.object({
  personCode,
  certSeries: optText,
  certNumber: reqText("Arayışın nömrəsi"),
  issueDate: reqDate("Arayışın verilmə tarixi"),
  group: enumFrom("Əlillik qrupu", {
    "1": "GROUP_1",
    i: "GROUP_1",
    "i qrup": "GROUP_1",
    "1 qrup": "GROUP_1",
    "1-ci qrup": "GROUP_1",
    "birinci qrup": "GROUP_1",
    "2": "GROUP_2",
    ii: "GROUP_2",
    "ii qrup": "GROUP_2",
    "2 qrup": "GROUP_2",
    "2-ci qrup": "GROUP_2",
    "ikinci qrup": "GROUP_2",
    "3": "GROUP_3",
    iii: "GROUP_3",
    "iii qrup": "GROUP_3",
    "3 qrup": "GROUP_3",
    "3-cü qrup": "GROUP_3",
    "üçüncü qrup": "GROUP_3",
    "18 yaşadək": "CHILD_UNDER_18",
    "sağlamlıq imkanları məhdud uşaq": "CHILD_UNDER_18",
  } as const),
  validFrom: reqDate("Arayışın qüvvəyə minmə tarixi"),
  validTo: optDate("Arayışın qüvvədə olma tarixi"),
});

const disabilities: SheetDef<typeof disabilitySchema> = {
  key: "disabilities",
  templateKey: "kadr",
  sheetNames: ["Əlillik məlumatları"],
  stage: "S6_PROFILES",
  title: "Əlillik məlumatları",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "certSeries", header: "Arayışın seriyası" },
    { key: "certNumber", header: "Arayışın nömrəsi", required: true },
    { key: "issueDate", header: "Arayışın verilmə tarixi", required: true },
    { key: "group", header: "Əlillik qrupu", required: true },
    { key: "validFrom", header: "Arayışın qüvvəyə minmə tarixi", required: true },
    { key: "validTo", header: "Arayışın qüvvədə olma tarixi" },
  ],
  schema: disabilitySchema,
  semantic: (r) => [...dateOrder(r.validFrom, r.validTo, "validTo", "Qüvvədə olma tarixi"), ...notFuture(r.issueDate, "issueDate", "Verilmə tarixi")],
  references: (r, ctx) => personRef(ctx, r.personCode),
};

// ============================================================================
//  2 Əməkdaşların ailə məlumatları.xlsx — Mərhələ 6
// ============================================================================

export const CHILD_RELATIONS = new Set(["oğul", "qız", "əlil uşaq", "övlad", "uşaq", "oğlu", "qızı"]);

/** Qayda: uşaq işə qəbuldan sonra doğulubsa → doğum tarixi; əks halda → işə qəbul tarixi */
export function familyRegistrationDate(birthDate: Date, hireDate: Date): Date {
  return birthDate > hireDate ? birthDate : hireDate;
}

const familySchema = z.object({
  personCode,
  fullName: reqText("Qohumun adı"),
  relation: reqText("Qohumluğun dərəcəsi").transform((v) => v.toLocaleLowerCase("az")),
  birthDate: reqDate("Doğum tarixi"),
  registrationDate: optDate("Qeydiyyatın tarixi"),
  workplace: optText,
  position: optText,
});

const family: SheetDef<typeof familySchema> = {
  key: "family",
  templateKey: "family",
  sheetNames: ["Ailə məlumatları"],
  stage: "S6_PROFILES",
  title: "Ailə məlumatları",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "fullName", header: "Qohumun adı", aliases: ["Qohumunun adı"], required: true, width: 200 },
    { key: "relation", header: "Qohumluğun dərəcəsi", required: true },
    { key: "birthDate", header: "Doğum tarixi", required: true },
    { key: "registrationDate", header: "Qeydiyyatın tarixi", aliases: ["Qeydiyyat tarixi"] },
    { key: "workplace", header: "İş yeri" },
    { key: "position", header: "Vəzifəsi" },
  ],
  schema: familySchema,
  semantic: (r) => notFuture(r.birthDate, "birthDate", "Doğum tarixi"),
  references: (r, ctx) => {
    const out = personRef(ctx, r.personCode);
    if (!CHILD_RELATIONS.has(r.relation)) return out;
    const hire = primaryHireDate(ctx, r.personCode);
    if (!hire) {
      if (ctx.persons.has(r.personCode)) out.push(err("registrationDate", "reference", "Uşağın qeydiyyat tarixini hesablamaq üçün əməkdaşın qəbul tarixi tapılmadı"));
      return out;
    }
    const expected = familyRegistrationDate(r.birthDate, hire);
    if (r.registrationDate && !sameDay(r.registrationDate, expected)) {
      const rule = r.birthDate > hire ? "uşaq işə qəbuldan sonra doğulub → doğum tarixi" : "uşaq işə qəbuldan əvvəl doğulub → qəbul tarixi";
      out.push(err("registrationDate", "semantic", `Qeydiyyatın tarixi ${formatAzDate(expected)} olmalıdır (${rule})`, formatAzDate(expected)));
    }
    return out;
  },
};

// ============================================================================
//  6 Digər məlumatlar.xlsx — Mərhələ 6
// ============================================================================

const patentSchema = z.object({
  personCode,
  inventionName: reqText("İxtira adı"),
  inventionDate: optDate("İxtira tarixi"),
  patentName: optText,
  patentNumber: optText,
  patentDate: optDate("Patentin tarixi"),
  certificateName: optText,
  certificateNumber: optText,
  certificateDate: optDate("Şəhadətnamənin tarixi"),
});

const patents: SheetDef<typeof patentSchema> = {
  key: "patents",
  templateKey: "other",
  sheetNames: ["Patent və şəhadətnamələr"],
  stage: "S6_PROFILES",
  title: "Patent və şəhadətnamələr",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "inventionName", header: "İxtira adı", aliases: ["İxtiranın adı"], required: true, width: 220 },
    { key: "inventionDate", header: "İxtira tarixi" },
    { key: "patentName", header: "Patent" },
    { key: "patentNumber", header: "Patentin nömrəsi" },
    { key: "patentDate", header: "Patentin tarixi" },
    { key: "certificateName", header: "Şəhadətnamə" },
    { key: "certificateNumber", header: "Şəhadətnamənin nömrəsi" },
    { key: "certificateDate", header: "Şəhadətnamənin tarixi" },
  ],
  schema: patentSchema,
  semantic: (r) => {
    const out: FieldIssue[] = [];
    if (!r.patentName && !r.patentNumber && !r.certificateName && !r.certificateNumber)
      out.push(warn("patentName", "semantic", "Nə patent, nə də şəhadətnamə məlumatı göstərilməyib"));
    if ((r.patentNumber || r.patentDate) && !r.patentName) out.push(warn("patentName", "semantic", "Patentin adı göstərilməyib"));
    if ((r.certificateNumber || r.certificateDate) && !r.certificateName) out.push(warn("certificateName", "semantic", "Şəhadətnamənin adı göstərilməyib"));
    out.push(...dateOrder(r.inventionDate, r.patentDate, "patentDate", "Patentin tarixi"));
    return out;
  },
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const projectSchema = z.object({
  personCode,
  title: reqText("Layihənin adı"),
  projectDate: optDate("Layihənin tarixi"),
  startDate: optDate("Layihənin başlama tarixi"),
  endDate: optDate("Layihənin bitmə tarixi"),
  grantAmount: optNumber("Qrant məbləği", { min: 0 }),
  comment: optText,
});

const projects: SheetDef<typeof projectSchema> = {
  key: "projects",
  templateKey: "other",
  sheetNames: ["Layihələr və qrantlar"],
  stage: "S6_PROFILES",
  title: "Layihələr və qrantlar",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "title", header: "Layihənin adı", required: true, width: 240 },
    { key: "projectDate", header: "Layihənin tarixi" },
    { key: "startDate", header: "Layihənin başlama tarixi" },
    // Şablonda "Lahiyənin" kimi yazılıb
    { key: "endDate", header: "Lahiyənin bitmə tarixi", aliases: ["Layihənin bitmə tarixi"] },
    { key: "grantAmount", header: "Layihə üzrə aldığı qrant məbləği", aliases: ["Qrant məbləği"] },
    { key: "comment", header: "Şərh", width: 200 },
  ],
  schema: projectSchema,
  semantic: (r) => dateOrder(r.startDate, r.endDate, "endDate"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const eventSchema = z.object({ personCode, eventType: reqText("Tədbir növü"), date: optDate("Tədbirin keçirilmə tarixi"), topic: optText, comment: optText });
const events: SheetDef<typeof eventSchema> = {
  key: "events",
  templateKey: "other",
  sheetNames: ["Tədbirlərdə iştirak"],
  stage: "S6_PROFILES",
  title: "Tədbirlərdə iştirak",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "eventType", header: "Tədbir növü", aliases: ["Tədbirin növü"], required: true },
    { key: "date", header: "Tədbirin keçirilmə tarixi" },
    { key: "topic", header: "Tədbirin mövzusu", width: 240 },
    { key: "comment", header: "Şərh", width: 200 },
  ],
  schema: eventSchema,
  semantic: (r) => notFuture(r.date, "date", "Keçirilmə tarixi"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const publicationSchema = z.object({ personCode, title: reqText("Əsərin adı"), publishedDate: optDate("Nəşr olunma tarixi"), topic: optText, comment: optText });
const publications: SheetDef<typeof publicationSchema> = {
  key: "publications",
  templateKey: "other",
  sheetNames: ["Əməkdaşın əsərləri"],
  stage: "S6_PROFILES",
  title: "Əməkdaşın əsərləri",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "title", header: "Əsərin adı", required: true, width: 260 },
    { key: "publishedDate", header: "Nəşr olunma tarixi" },
    { key: "topic", header: "Mövzu", width: 200 },
    { key: "comment", header: "Şərh", width: 200 },
  ],
  schema: publicationSchema,
  semantic: (r) => notFuture(r.publishedDate, "publishedDate", "Nəşr olunma tarixi"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const attestationSchema = z.object({
  personCode,
  date: reqDate("Attestasiyanın keçirilmə tarixi"),
  orderDate: optDate("Əmrin tarixi"),
  orderNumber: optText,
  result: reqText("Attestasiya nəticəsi"),
});
const attestations: SheetDef<typeof attestationSchema> = {
  key: "attestations",
  templateKey: "other",
  sheetNames: ["Attestasiya məlumatları"],
  stage: "S6_PROFILES",
  title: "Attestasiya məlumatları",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "date", header: "Attestasiyanın keçirilmə tarixi", required: true },
    { key: "orderDate", header: "Əmrin tarixi" },
    { key: "orderNumber", header: "Əmrin nömrəsi" },
    { key: "result", header: "Attestasiya nəticəsi", required: true },
  ],
  schema: attestationSchema,
  semantic: (r) => (r.orderDate && r.orderDate < r.date ? [warn("orderDate", "semantic", "Əmr attestasiyadan əvvəlki tarixlidir")] : []),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

// ============================================================================
//  7 Əməkdaşların elmi tədqiqat və işləmələri.xlsx — Mərhələ 6
// ============================================================================

const researchSchema = z.object({
  personCode,
  topic: reqText("Elmi tədqiqat və ya işləmənin adı"),
  category: optText,
  domain: optText,
  startDate: optDate("Başlama tarixi"),
  endDate: optDate("Bitmə tarixi"),
});

const research: SheetDef<typeof researchSchema> = {
  key: "research",
  templateKey: "research",
  sheetNames: ["Elmi tədqiqat və ya işləmələr"],
  stage: "S6_PROFILES",
  title: "Elmi tədqiqat və işləmələr",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "topic", header: "Elmi tədqiqat və ya işləmənin adı", required: true, width: 260 },
    { key: "category", header: "Elmi tədqiqat və ya işləmə üzrə bölgü" },
    { key: "domain", header: "Elm sahəsi" },
    { key: "startDate", header: "Başlama tarixi" },
    { key: "endDate", header: "Bitmə tarixi" },
  ],
  schema: researchSchema,
  semantic: (r) => dateOrder(r.startDate, r.endDate, "endDate"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

// ============================================================================
//  8 Fiziki şəxsə aid məlumatlar.xlsx — Mərhələ 6
// ============================================================================

const languageSchema = z.object({ personCode, language: reqText("Əməkdaşın bildiyi dil"), level: proficiency("Bilmə səviyyəsi") });
const languages: SheetDef<typeof languageSchema> = {
  key: "languages",
  templateKey: "personal",
  sheetNames: ["Dil bilikləri"],
  stage: "S6_PROFILES",
  title: "Dil bilikləri",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "language", header: "Əməkdaşın bildiyi dil", required: true },
    { key: "level", header: "Bilmə səviyyəsi (əla/yaxşı/kafi)", aliases: ["Bilmə səviyyəsi"], required: true },
  ],
  schema: languageSchema,
  references: (r, ctx, row) => [
    ...personRef(ctx, r.personCode),
    ...unique(ctx, `lang:${r.personCode}|${normalizeKey(r.language)}`, row, "language", (p) => `Bu dil №${p} sətirdə artıq qeyd olunub`),
  ],
};

const educationSchema = z.object({
  personCode,
  educationType: reqText("Təhsilin növü"),
  institution: reqText("Təhsil müəssisəsinin adı"),
  specialty: optText,
  diplomaSeriesNumber: optText,
  startDate: optYearOrDate("Daxil olduğu il"),
  graduationDate: optYearOrDate("Bitirdiyi il"),
  qualification: optText,
  specialization: optText,
  studyForm: optText,
  isAbroad: flag("Xaricdə təhsil"),
});
const educations: SheetDef<typeof educationSchema> = {
  key: "educations",
  templateKey: "personal",
  sheetNames: ["Təhsil məlumatları"],
  stage: "S6_PROFILES",
  title: "Təhsil məlumatları",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "educationType", header: "Təhsilin növü", required: true },
    { key: "institution", header: "Təhsil müəssisəsinin adı", required: true, width: 240 },
    { key: "specialty", header: "İxtisası", width: 180 },
    { key: "diplomaSeriesNumber", header: "Diplomun seriya və nömrəsi" },
    { key: "startDate", header: "Daxil olduğu il" },
    { key: "graduationDate", header: "Bitirdiyi il" },
    { key: "qualification", header: "Kvalifikasiya" },
    { key: "specialization", header: "İxtisaslaşma sahəsi" },
    { key: "studyForm", header: "Təhsil alma növü" },
    { key: "isAbroad", header: "Xaricdə təhsil (bəli/xeyr)" },
  ],
  schema: educationSchema,
  semantic: (r) => dateOrder(r.startDate, r.graduationDate, "graduationDate", "Bitirdiyi il"),
  references: (r, ctx) => {
    const out = personRef(ctx, r.personCode);
    const p = ctx.persons.get(r.personCode);
    if (p && r.graduationDate && r.graduationDate < addYears(p.birthDate, 14)) out.push(err("graduationDate", "reference", "Bitirmə tarixi doğum tarixinə görə qeyri-realdır"));
    return out;
  },
};

function skillSheet(key: "skills" | "software") {
  const isSoftware = key === "software";
  const schema = z.object({
    personCode,
    name: reqText(isSoftware ? "Əməkdaşın bildiyi proqram" : "Peşənin adı"),
    proficiency: isSoftware
      ? proficiency("Bilmə səviyyəsi")
      : z.unknown().transform((): "EXCELLENT" | "GOOD" | "SATISFACTORY" | undefined => undefined),
  });
  const def: SheetDef<typeof schema> = {
    key,
    templateKey: "personal",
    sheetNames: [isSoftware ? "Kompyuter bilikləri" : "Peşə bacarıqları"],
    stage: "S6_PROFILES",
    title: isSoftware ? "Kompyuter bilikləri" : "Peşə bacarıqları",
    personScoped: true,
    columns: isSoftware
      ? [
          PERSON_COL,
          { key: "name", header: "Əməkdaşın bildiyi proqram", required: true },
          { key: "proficiency", header: "Bilmə səviyyəsi (əla/yaxşı/kafi)", aliases: ["Bilmə səviyyəsi"], required: true },
        ]
      : [PERSON_COL, { key: "name", header: "Peşənin adı", required: true, width: 240 }],
    schema,
    references: (r, ctx, row) => [
      ...personRef(ctx, r.personCode),
      ...unique(ctx, `${key}:${r.personCode}|${normalizeKey(r.name)}`, row, "name", (p) => `№${p} sətirdə artıq qeyd olunub`),
    ],
  };
  return def;
}
const skills = skillSheet("skills");
const software = skillSheet("software");

/** "İqtisad üzrə fəlsəfə doktoru" kimi tam adları tanıyır */
export function classifyDegree(v: string): "PHD" | "DSC" | null {
  const s = normalizeKey(v);
  if (s.includes("elmler doktoru") || s === "dsc") return "DSC";
  if (s.includes("felsefe doktoru") || s.includes("namizedi") || s === "phd") return "PHD";
  return null;
}
const degreeName = reqText("Elmi dərəcə").superRefine((v, ctx) => {
  if (!classifyDegree(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elmi dərəcə "fəlsəfə doktoru" və ya "elmlər doktoru" olmalıdır' });
});

const degreeSchema = z.object({
  personCode,
  degreeName,
  awardDate: reqDate("Elmi dərəcənin verilmə tarixi"),
  field: optText,
  dissertationCouncil: optText,
  diplomaSeriesNumber: optText,
  diplomaCode: optText,
  issuingInstitution: optText,
});
const degrees: SheetDef<typeof degreeSchema> = {
  key: "degrees",
  templateKey: "personal",
  sheetNames: ["Elmi dərəcələr"],
  stage: "S6_PROFILES",
  title: "Elmi dərəcələr",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "degreeName", header: "Elmi dərəcə", required: true, width: 220 },
    { key: "awardDate", header: "Elmi dərəcənin verilmə tarixi", required: true },
    { key: "field", header: "Elmi fəaliyyət sahəsi" },
    { key: "dissertationCouncil", header: "Dissertasiya şurası" },
    { key: "diplomaSeriesNumber", header: "Diplomun seriyası və nömrəsi" },
    { key: "diplomaCode", header: "Diplomun şifrəsi" },
    { key: "issuingInstitution", header: "Diplomu təqdim edən müəssisənin adı", width: 220 },
  ],
  schema: degreeSchema,
  semantic: (r) => notFuture(r.awardDate, "awardDate", "Verilmə tarixi"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

export function classifyTitle(v: string): "DOCENT" | "PROFESSOR" | "CORRESPONDING_MEMBER" | "ACADEMICIAN" | null {
  const s = normalizeKey(v);
  if (s.includes("muxbir")) return "CORRESPONDING_MEMBER";
  if (s.includes("akademik") || s.includes("heqiqi uzv")) return "ACADEMICIAN";
  if (s.includes("professor")) return "PROFESSOR";
  if (s.includes("dosent") || s.includes("docent")) return "DOCENT";
  return null;
}
const titleName = reqText("Elmi ad").superRefine((v, ctx) => {
  if (!classifyTitle(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elmi ad "dosent", "professor", "müxbir üzv" və ya "akademik" olmalıdır' });
});

const titleSchema = z.object({
  personCode,
  titleName,
  awardDate: reqDate("Elmi adın verilmə tarixi"),
  direction: optText,
  attestatSeries: optText,
  diplomaNumber: optText,
  issuingInstitution: optText,
});
const titles: SheetDef<typeof titleSchema> = {
  key: "titles",
  templateKey: "personal",
  sheetNames: ["Elmi adlar"],
  stage: "S6_PROFILES",
  title: "Elmi adlar",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "titleName", header: "Elmi ad", required: true },
    { key: "awardDate", header: "Elmi adın verilmə tarixi", required: true },
    { key: "direction", header: "Elmi ad istiqaməti" },
    { key: "attestatSeries", header: "Attestat seriyası" },
    { key: "diplomaNumber", header: "Diplomun nömrəsi" },
    { key: "issuingInstitution", header: "Diplomu təqdim edən müəssisənin adı", width: 220 },
  ],
  schema: titleSchema,
  semantic: (r) => notFuture(r.awardDate, "awardDate", "Verilmə tarixi"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const AWARD_SHEETS = {
  honoraryTitles: { sheet: "Fəxri adlar", name: "Fəxri adı", date: "Fəxri adın verilmə tarixi", order: "Fəxri adın verilmə əmrinin nömrəsi" },
  stateAwards: { sheet: "Dövlət təltifləri", name: "Dövlət təltifi", date: "Dövlət təltifinin verilmə tarixi", order: "Dövlət təltifinin verilmə əmrinin nömrəsi" },
  prizes: { sheet: "Mükafatlar", name: "Mükafat", date: "Mükafatın verilmə tarixi", order: "Mükafatın verilmə əmrinin nömrəsi" },
} as const;

function awardSheet(key: keyof typeof AWARD_SHEETS) {
  const cfg = AWARD_SHEETS[key];
  const schema = z.object({ personCode, name: reqText(cfg.name), awardDate: optDate(cfg.date), orderNumber: optText, issuedBy: optText });
  const def: SheetDef<typeof schema> = {
    key,
    templateKey: "personal",
    sheetNames: [cfg.sheet],
    stage: "S6_PROFILES",
    title: cfg.sheet,
    personScoped: true,
    columns: [
      PERSON_COL,
      { key: "name", header: cfg.name, required: true, width: 240 },
      { key: "awardDate", header: cfg.date },
      { key: "orderNumber", header: cfg.order },
      { key: "issuedBy", header: "Kim tərəfindən verilib" },
    ],
    schema,
    semantic: (r) => notFuture(r.awardDate, "awardDate", "Verilmə tarixi"),
    references: (r, ctx) => personRef(ctx, r.personCode),
  };
  return def;
}
const honoraryTitles = awardSheet("honoraryTitles");
const stateAwards = awardSheet("stateAwards");
const prizes = awardSheet("prizes");

const partySchema = z.object({
  personCode,
  isMember: flag("Partiya mənsubluğu"),
  party: optText,
  cardNumber: optText,
  cardIssueDate: optDate("Partiya biletinin verilmə tarixi"),
});
const parties: SheetDef<typeof partySchema> = {
  key: "parties",
  templateKey: "personal",
  sheetNames: ["Partiya mənsubluğu"],
  stage: "S6_PROFILES",
  title: "Partiya mənsubluğu",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "isMember", header: "Partiya mənsubluğu (bəli/xeyr)", required: true },
    { key: "party", header: "Partiyanın adı", width: 200 },
    { key: "cardNumber", header: "Partiya biletinin nömrəsi" },
    { key: "cardIssueDate", header: "Partiya biletinin verilmə tarixi" },
  ],
  schema: partySchema,
  semantic: (r) => {
    if (r.isMember && !r.party) return [err("party", "semantic", 'Partiya mənsubluğu "bəli" olduqda partiyanın adı məcburidir')];
    if (!r.isMember && (r.party || r.cardNumber)) return [warn("isMember", "semantic", "Partiya məlumatı doldurulub, lakin mənsubluq = xeyr")];
    return [];
  },
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const electedSchema = z.object({
  personCode,
  location: optText,
  organName: reqText("Seçki orqanının adı"),
  position: optText,
  electedDate: optDate("Seçildiyi tarix"),
  exitDate: optDate("Çıxdığı tarix"),
});
const electedOrgans: SheetDef<typeof electedSchema> = {
  key: "electedOrgans",
  templateKey: "personal",
  sheetNames: ["Seçki orqanlarında iştirakı"],
  stage: "S6_PROFILES",
  title: "Seçki orqanlarında iştirak",
  personScoped: true,
  columns: [
    PERSON_COL,
    { key: "location", header: "Seçki orqanının olduğu yer" },
    { key: "organName", header: "Seçki orqanının adı", required: true, width: 220 },
    { key: "position", header: "Seçildiyi vəzifə" },
    { key: "electedDate", header: "Seçildiyi tarix" },
    { key: "exitDate", header: "Çıxdığı tarix" },
  ],
  schema: electedSchema,
  semantic: (r) => dateOrder(r.electedDate, r.exitDate, "exitDate", "Çıxdığı tarix"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

const liabilitySchema = z.object({ personCode, reason: reqText("Məhkəmə məsuliyyətinin səbəbi"), date: optDate("Tarixi") });
const liabilities: SheetDef<typeof liabilitySchema> = {
  key: "liabilities",
  templateKey: "personal",
  sheetNames: ["Məhkəmə məsuliyyəti"],
  stage: "S6_PROFILES",
  title: "Məhkəmə məsuliyyəti",
  personScoped: true,
  columns: [PERSON_COL, { key: "reason", header: "Məhkəmə məsuliyyətinin səbəbi", required: true, width: 260 }, { key: "date", header: "Tarixi" }],
  schema: liabilitySchema,
  semantic: (r) => notFuture(r.date, "date", "Tarix"),
  references: (r, ctx) => personRef(ctx, r.personCode),
};

// ============================================================================
//  3 Məzuniyyətlərin qalıqları.xlsx — 4 vərəq — Mərhələ 7
// ============================================================================

export const LEAVE_SHEETS = {
  leaveBasic: { field: "basicDays", title: "Əsas məzuniyyət", sheetNames: ["Əsas məzuniyyət"] },
  leaveSeniority: { field: "seniorityDays", title: "Staja görə əlavə", sheetNames: ["Staja görə əlavə günləri"] },
  leaveHazardous: { field: "hazardousDays", title: "İş şəraitinə görə əlavə", sheetNames: ["İş şəraitinə görə əlavə günləri"] },
  leaveMotherhood: { field: "motherhoodDays", title: "Qadınların əlavə günləri", sheetNames: ["Qadınların əlavə günləri"] },
} as const;
export type LeaveSheetKey = keyof typeof LEAVE_SHEETS;

/**
 * Tam iş ili: təlimatdakı nümunə "01.08.2021 – 01.08.2022" (+1 il), tapşırıq isə "+1 il − 1 gün" tələb edir.
 * Hər ikisi qəbul olunur və bazada +1 il − 1 gün kimi saxlanılır.
 */
export function normalizeWorkYearEnd(start: Date, end: Date): Date | null {
  const canonical = fullYearEnd(start);
  if (sameDay(end, canonical) || sameDay(end, addYears(start, 1))) return canonical;
  return null;
}

function leaveSheet(key: LeaveSheetKey) {
  const cfg = LEAVE_SHEETS[key];
  const schema = z.object({
    personCode,
    periodStart: reqDate("Əmək ilinin başlanğıc tarixi"),
    periodEnd: reqDate("Əmək ilinin bitmə tarixi"),
    days: reqNumber("Gün sayı", { min: 0, max: 120 }),
  });
  const def: SheetDef<typeof schema> = {
    key,
    templateKey: "leave",
    sheetNames: [...cfg.sheetNames],
    stage: "S7_LEAVE_BALANCES",
    title: cfg.title,
    columns: [
      PERSON_COL,
      { key: "periodStart", header: "Əmək ilinin başlanğıc tarixi", aliases: ["Başlanğıc tarixi"], required: true },
      { key: "periodEnd", header: "Əmək ilinin bitmə tarixi", aliases: ["Bitmə tarixi"], required: true },
      { key: "days", header: "Gün sayı", aliases: ["Günlərin miqdarı"], required: true },
    ],
    schema,
    semantic: (r) => {
      const end = normalizeWorkYearEnd(r.periodStart, r.periodEnd);
      if (!end) {
        const s1 = formatAzDate(addYears(r.periodStart, 1));
        return [err("periodEnd", "semantic", `Natamam iş ili yüklənə bilməz: bitmə tarixi ${s1} (və ya ${formatAzDate(fullYearEnd(r.periodStart))}) olmalıdır`, s1)];
      }
      if (end >= LEAVE_BALANCE_AS_OF) return [err("periodEnd", "semantic", `Yalnız ${formatAzDate(LEAVE_BALANCE_AS_OF)} tarixinədək tamamlanmış iş illərinin qalıqları yüklənir`)];
      return [];
    },
    references: (r, ctx, row) => {
      const out = personRef(ctx, r.personCode);
      const hire = primaryHireDate(ctx, r.personCode);
      if (ctx.persons.has(r.personCode) && !hire) out.push(err("personCode", "reference", "Əməkdaşın əmək müqaviləsi (Əməkdaşlar vərəqi) tapılmadı"));
      if (hire) {
        if (r.periodStart < hire) out.push(warn("periodStart", "reference", `İş ili qəbul tarixindən (${formatAzDate(hire)}) əvvəl başlayır`));
        else if (r.periodStart.getUTCDate() !== hire.getUTCDate() || r.periodStart.getUTCMonth() !== hire.getUTCMonth())
          out.push(warn("periodStart", "reference", `İş ili adətən qəbul tarixinin ildönümündən (${formatAzDate(hire).slice(0, 5)}) başlayır`));
      }
      if (key === "leaveMotherhood" && r.days > 0 && ctx.persons.get(r.personCode)?.gender === "MALE")
        out.push(err("days", "reference", "14 yaşadək uşağı olan qadınlara əlavə məzuniyyət kişi əməkdaşa şamil edilmir"));
      out.push(...unique(ctx, `${key}:${r.personCode}|${formatAzDate(r.periodStart)}`, row, "periodStart", (p) => `Eyni iş ili №${p} sətirdə təkrarlanır`));
      return out;
    },
  };
  return def;
}
const leaveBasic = leaveSheet("leaveBasic");
const leaveSeniority = leaveSheet("leaveSeniority");
const leaveHazardous = leaveSheet("leaveHazardous");
const leaveMotherhood = leaveSheet("leaveMotherhood");

// ============================================================================
//  9 İşdə iştirak etməmə.xlsx — 3 vərəq — Mərhələ 8
// ============================================================================

type AbsenceTypeKey = "SICK" | "UNKNOWN" | "SOCIAL_PAID" | "SOCIAL_UNPAID" | "UNPAID";

export const ABSENCE_SHEETS = {
  absencesSick: {
    title: "Xəstəliklər və naməlum",
    sheetNames: ["Xəstəliklər və naməlum"],
    header: "İşdə olmama səbəbi (xəstəlik və ya naməlum)",
    map: { xəstəlik: "SICK", naməlum: "UNKNOWN" } as Record<string, AbsenceTypeKey>,
  },
  absencesSocial: {
    title: "Sosial məzuniyyət",
    // Excel vərəq adını 31 simvolda kəsir
    sheetNames: ["Qismən ödənişli sosial məzuniyy", "Qismən ödənişli sosial məzuniyyət"],
    header: "İşdə olmama səbəbi (ö/sm və ya sm)",
    map: { "ö/sm": "SOCIAL_UNPAID", sm: "SOCIAL_PAID" } as Record<string, AbsenceTypeKey>,
  },
  absencesUnpaid: {
    title: "Ödənişsiz məzuniyyət",
    sheetNames: ["Ödənişsiz məzuniyyət"],
    header: "İşdə olmama səbəbi (ö/m)",
    map: { "ö/m": "UNPAID" } as Record<string, AbsenceTypeKey>,
  },
} as const;
export type AbsenceSheetKey = keyof typeof ABSENCE_SHEETS;

function absenceSheet(key: AbsenceSheetKey) {
  const cfg = ABSENCE_SHEETS[key];
  const schema = z.object({
    personCode,
    type: enumFrom("İşdə olmama səbəbi", cfg.map),
    startDate: reqDate("Başlama tarixi"),
    endDate: reqDate("Bitmə tarixi"),
  });
  const def: SheetDef<typeof schema> = {
    key,
    templateKey: "absences",
    sheetNames: [...cfg.sheetNames],
    stage: "S8_MOVEMENTS",
    title: cfg.title,
    personScoped: true,
    columns: [
      PERSON_COL,
      { key: "type", header: cfg.header, aliases: ["İşdə olmama səbəbi"], required: true, width: 200 },
      { key: "startDate", header: "Başlama tarixi", required: true },
      { key: "endDate", header: "Bitmə tarixi", required: true },
    ],
    schema,
    semantic: (r) => [...dateOrder(r.startDate, r.endDate, "endDate"), ...inMovementPeriod(r.startDate, "startDate")],
    references: (r, ctx) => {
      const out = personRef(ctx, r.personCode);
      const hire = primaryHireDate(ctx, r.personCode);
      if (hire && r.startDate < hire) out.push(err("startDate", "reference", `Başlama tarixi qəbul tarixindən (${formatAzDate(hire)}) əvvəldir`));
      return out;
    },
  };
  return def;
}
const absencesSick = absenceSheet("absencesSick");
const absencesSocial = absenceSheet("absencesSocial");
const absencesUnpaid = absenceSheet("absencesUnpaid");

// ============================================================================
//  10 İşdən azad olunmuş əməkdaşlar.xlsx — Mərhələ 8
// ============================================================================

const terminationSchema = z.object({
  personCode,
  positionCode: code("Vəzifə (kodu)"),
  departmentCode: code("Struktur bölməsi (kodu)"),
  terminationDate: reqDate("Xitam verilmə tarixi"),
  terminationArticle: reqText("Maddə").refine((v) => /\d/.test(v), 'AR ƏM maddəsinin nömrəsi göstərilməlidir (məs. "68.1")'),
});

const terminations: SheetDef<typeof terminationSchema> = {
  key: "terminations",
  templateKey: "terminations",
  sheetNames: ["İşdən azad olunmuş əməkdaşlar"],
  stage: "S8_MOVEMENTS",
  title: "İşdən azad olunmuş əməkdaşlar",
  columns: [
    PERSON_COL,
    { key: "positionCode", header: "Vəzifə (kodu)", required: true },
    { key: "departmentCode", header: "Struktur bölməsi (kodu)", required: true },
    { key: "terminationDate", header: "Xitam verilmə tarixi", aliases: ["İşdən azad olma tarixi"], required: true },
    { key: "terminationArticle", header: "Maddə", aliases: ["AR ƏM maddəsi"], required: true },
  ],
  schema: terminationSchema,
  semantic: (r) => inMovementPeriod(r.terminationDate, "terminationDate"),
  references: (r, ctx, row) => {
    const out = personRef(ctx, r.personCode);
    if (!ctx.persons.has(r.personCode)) return out;
    const match = (ctx.employments.get(r.personCode) ?? []).find((e) => e.active && e.positionCode === r.positionCode && e.departmentCode === r.departmentCode);
    if (!match) out.push(err("positionCode", "reference", `${r.departmentCode} bölməsində ${r.positionCode} vəzifəsində aktiv əmək müqaviləsi tapılmadı`));
    else if (r.terminationDate < match.hireDate)
      out.push(err("terminationDate", "reference", `Xitam tarixi qəbul tarixindən (${formatAzDate(match.hireDate)}) əvvəl ola bilməz`));
    out.push(
      ...unique(ctx, `term:${r.personCode}|${r.positionCode}|${r.departmentCode}`, row, "personCode", (p) => `Eyni müqaviləyə xitam №${p} sətirdə artıq var`),
    );
    return out;
  },
};

// ============================================================================
//  Reyestr
// ============================================================================

export const SHEETS = {
  departments1,
  departments2,
  departments3,
  departments4,
  positions,
  staffing,
  persons,
  employments,
  workHistory,
  military,
  disabilities,
  family,
  patents,
  projects,
  events,
  publications,
  attestations,
  research,
  languages,
  educations,
  skills,
  degrees,
  titles,
  honoraryTitles,
  stateAwards,
  prizes,
  software,
  parties,
  electedOrgans,
  liabilities,
  leaveBasic,
  leaveSeniority,
  leaveHazardous,
  leaveMotherhood,
  absencesSick,
  absencesSocial,
  absencesUnpaid,
  terminations,
} satisfies Record<SheetKey, { key: SheetKey }>;

export type SheetRow<K extends SheetKey> = z.infer<(typeof SHEETS)[K]["schema"]>;

export function getSheet(key: SheetKey): SheetDef {
  return SHEETS[key] as unknown as SheetDef;
}

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  kadr: {
    key: "kadr",
    number: 1,
    fileName: "1 Kadr Cədvəlləri.xlsx",
    title: "Kadr cədvəlləri",
    sheets: ["persons", "positions", "employments", "workHistory", "military", "disabilities"],
  },
  family: { key: "family", number: 2, fileName: "2 Əməkdaşların ailə məlumatları.xlsx", title: "Ailə məlumatları", sheets: ["family"] },
  leave: {
    key: "leave",
    number: 3,
    fileName: "3 Məzuniyyətlərin qalıqları.xlsx",
    title: "Məzuniyyətlərin qalıqları",
    sheets: ["leaveBasic", "leaveSeniority", "leaveHazardous", "leaveMotherhood"],
  },
  staffing: { key: "staffing", number: 4, fileName: "4 Ştat cədvəli.xlsx", title: "Ştat cədvəli", sheets: ["staffing"] },
  departments: { key: "departments", number: 5, fileName: "5 Struktur bölmələri.xlsx", title: "Struktur bölmələri", sheets: [...DEPARTMENT_SHEETS] },
  other: {
    key: "other",
    number: 6,
    fileName: "6 Digər məlumatlar.xlsx",
    title: "Digər məlumatlar",
    sheets: ["patents", "projects", "events", "publications", "attestations"],
  },
  research: { key: "research", number: 7, fileName: "7 Əməkdaşların elmi tədqiqat və işləmələri.xlsx", title: "Elmi tədqiqat və işləmələr", sheets: ["research"] },
  personal: {
    key: "personal",
    number: 8,
    fileName: "8 Fiziki şəxsə aid məlumatlar.xlsx",
    title: "Fiziki şəxsə aid məlumatlar",
    sheets: [
      "languages",
      "educations",
      "skills",
      "degrees",
      "titles",
      "honoraryTitles",
      "stateAwards",
      "prizes",
      "software",
      "parties",
      "electedOrgans",
      "liabilities",
    ],
  },
  absences: {
    key: "absences",
    number: 9,
    fileName: "9 İşdə iştirak etməmə.xlsx",
    title: "İşdə iştirak etməmə",
    sheets: ["absencesSick", "absencesSocial", "absencesUnpaid"],
  },
  terminations: { key: "terminations", number: 10, fileName: "10 İşdən azad olunmuş əməkdaşlar.xlsx", title: "İşdən azad olunmuş əməkdaşlar", sheets: ["terminations"] },
};

/** Fayl adının əvvəlindəki nömrəyə görə şablonu təyin edir ("3 Məzuniyyətlərin..." → leave) */
export function detectTemplateByName(fileName: string): TemplateKey | null {
  const m = /^\s*(\d{1,2})[\s._-]/.exec(fileName);
  if (!m) return null;
  const n = Number(m[1]);
  return (Object.values(TEMPLATES).find((t) => t.number === n)?.key ?? null) as TemplateKey | null;
}
