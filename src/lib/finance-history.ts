/**
 * Maliyyə tarixçəsi — saf funksiyalar (server və testlər üçün).
 *
 * Mənbələr:
 *  - FinancialChange — bu funksiyadan sonra hər yoldan (hərəkət forması, tam forma, sürətli redaktə, idxal) yazılan dəyişikliklər;
 *  - köhnə qeydlər üçün oxuma zamanı bərpa: FinancialChange-ə bağlı olmayan EmploymentMovement-lər və
 *    heç bir dəyişikliklə izah olunmayan SalaryRecord keçidləri ({@link deriveLegacyEvents}).
 *
 * «Tarixə görə baxış»: cari vəziyyətdən başlayıb qüvvəyə minmə tarixi seçilmiş gündən SONRA olan dəyişiklikləri
 * (ən yenidən geriyə) açırıq; oklad üçün həmin günü əhatə edən SalaryRecord üstündür.
 */
import { computePayroll, primaryEmploymentIds, type PayrollInput, type PayrollResult } from "./calc/payroll";
import { formatAzn, formatNumber } from "./utils";

export type FinanceFieldCode = "BASE_SALARY" | "UNIT_SHARE" | "PAYMENT_FORM" | "POSITION" | "DEPARTMENT" | "HAZARDOUS_PCT" | "TAX_EXEMPTION" | "DEGREE" | "TITLE";
/** FinanceSource + bərpa olunan mənbələr */
export type FinanceSourceCode = "MOVEMENT" | "EDIT" | "QUICK_EDIT" | "IMPORT" | "SALARY_RECORD";

export const FINANCE_FIELD_LABELS: Record<FinanceFieldCode, string> = {
  BASE_SALARY: "Oklad",
  UNIT_SHARE: "Ştat payı",
  PAYMENT_FORM: "Ödəniş forması",
  POSITION: "Vəzifə",
  DEPARTMENT: "Struktur bölmə",
  HAZARDOUS_PCT: "Zərərli şərait əlavəsi",
  TAX_EXEMPTION: "Vergi güzəşti",
  DEGREE: "Elmi dərəcə",
  TITLE: "Elmi ad",
};

export const FINANCE_SOURCE_LABELS: Record<FinanceSourceCode, string> = {
  MOVEMENT: "Kadr hərəkəti (əmr)",
  EDIT: "Redaktə (tam forma)",
  QUICK_EDIT: "Sürətli redaktə (struktur xəritəsi)",
  IMPORT: "İdxal",
  SALARY_RECORD: "Oklad tarixçəsi (köhnə qeyd)",
};

export interface FinanceEvent {
  key: string;
  employmentId: string | null;
  field: FinanceFieldCode;
  oldValue: string | null;
  newValue: string | null;
  oldLabel: string | null;
  newLabel: string | null;
  effectiveDate: Date;
  source: FinanceSourceCode;
  orderNumber: string | null;
  orderDate: Date | null;
  by: string | null;
  createdAt: Date;
  /** true — köhnə qeydlərdən oxuma zamanı bərpa olunub */
  derived: boolean;
}

export interface LegacyMovement {
  id: string;
  orderNumber: string;
  orderDate: Date;
  effectiveDate: Date;
  fromDepartmentId: string | null;
  fromDepartment: string | null;
  toDepartmentId: string | null;
  toDepartment: string | null;
  fromPositionId: string | null;
  fromPosition: string | null;
  toPositionId: string | null;
  toPosition: string | null;
  fromSalary: number | null;
  toSalary: number | null;
  fromUnitShare: number | null;
  toUnitShare: number | null;
  createdAt: Date;
  by: string | null;
}

export interface SalaryPeriod {
  baseSalary: number;
  validFrom: Date;
  validTo: Date | null;
}

/** Müqavilənin CARİ vəziyyəti + tarixçə mənbələri */
export interface EmploymentNow {
  id: string;
  hireDate: Date;
  terminationDate: Date | null;
  isPrimary: boolean;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  baseSalary: number;
  unitShare: number;
  paymentForm: string;
  salaryHistory: SalaryPeriod[];
  movements: LegacyMovement[];
}

export interface PersonNow {
  taxExemptionClause: string | null;
  degrees: { degree: PayrollInput["degrees"][number]; name: string; awardDate: Date }[];
  titles: { title: PayrollInput["titles"][number]; name: string; awardDate: Date }[];
}

/** Rəqəmlərin maşın dəyəri (müqayisə və geri açma üçün) */
export const num2 = (n: number | string | { toString(): string }) => Number(n).toFixed(2);

/** Cədvəldə göstərmək üçün: oklad — ₼, ştat — 0.50, faiz — %, vəzifə / bölmə — ad */
export function formatFinanceValue(field: FinanceFieldCode, value: string | null, label: string | null): string {
  if (label) return label;
  if (value === null || value === "") return "—";
  switch (field) {
    case "BASE_SALARY":
      return formatAzn(Number(value));
    case "UNIT_SHARE":
      return formatNumber(Number(value), 2);
    case "HAZARDOUS_PCT":
      return `${formatNumber(Number(value), 2).replace(/,00$/, "")}%`;
    case "TAX_EXEMPTION":
      return `VM ${value}`;
    default:
      return value;
  }
}

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();

/**
 * Köhnə qeydlərdən tarixçənin bərpası (oxuma zamanı, idempotent — heç nə yazılmır):
 *  1. FinancialChange-ə bağlı olmayan hər EmploymentMovement → bölmə / vəzifə / oklad / ştat payı dəyişiklikləri;
 *  2. SalaryRecord-un ardıcıl dövrləri arasında oklad fərqi — həmin gün üçün başqa oklad dəyişikliyi qeydi yoxdursa.
 */
export function deriveLegacyEvents(emps: EmploymentNow[], explicit: FinanceEvent[], linkedMovementIds: Set<string>): FinanceEvent[] {
  const out: FinanceEvent[] = [];
  for (const e of emps) {
    for (const m of e.movements) {
      if (linkedMovementIds.has(m.id)) continue;
      const base = { employmentId: e.id, effectiveDate: m.effectiveDate, source: "MOVEMENT" as const, orderNumber: m.orderNumber, orderDate: m.orderDate, by: m.by, createdAt: m.createdAt, derived: true };
      if (m.toDepartmentId !== null)
        out.push({ ...base, key: `mv:${m.id}:dept`, field: "DEPARTMENT", oldValue: m.fromDepartmentId, newValue: m.toDepartmentId, oldLabel: m.fromDepartment, newLabel: m.toDepartment });
      if (m.toPositionId !== null)
        out.push({ ...base, key: `mv:${m.id}:pos`, field: "POSITION", oldValue: m.fromPositionId, newValue: m.toPositionId, oldLabel: m.fromPosition, newLabel: m.toPosition });
      if (m.toSalary !== null)
        out.push({ ...base, key: `mv:${m.id}:sal`, field: "BASE_SALARY", oldValue: m.fromSalary === null ? null : num2(m.fromSalary), newValue: num2(m.toSalary), oldLabel: null, newLabel: null });
      if (m.toUnitShare !== null)
        out.push({
          ...base,
          key: `mv:${m.id}:share`,
          field: "UNIT_SHARE",
          oldValue: m.fromUnitShare === null ? null : num2(m.fromUnitShare),
          newValue: num2(m.toUnitShare),
          oldLabel: null,
          newLabel: null,
        });
    }
    const known = [...explicit, ...out].filter((x) => x.employmentId === e.id && x.field === "BASE_SALARY");
    const periods = [...e.salaryHistory].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1]!;
      const cur = periods[i]!;
      if (num2(prev.baseSalary) === num2(cur.baseSalary)) continue;
      if (known.some((k) => sameDay(k.effectiveDate, cur.validFrom))) continue;
      out.push({
        key: `sr:${e.id}:${cur.validFrom.toISOString().slice(0, 10)}`,
        employmentId: e.id,
        field: "BASE_SALARY",
        oldValue: num2(prev.baseSalary),
        newValue: num2(cur.baseSalary),
        oldLabel: null,
        newLabel: null,
        effectiveDate: cur.validFrom,
        source: "SALARY_RECORD",
        orderNumber: null,
        orderDate: null,
        by: null,
        createdAt: cur.validFrom,
        derived: true,
      });
    }
  }
  return out;
}

/** Ən yenidən köhnəyə: qüvvəyə minmə tarixi, sonra yazılma anı */
export const newestFirst = (a: FinanceEvent, b: FinanceEvent) => b.effectiveDate.getTime() - a.effectiveDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime();

export interface EmploymentState {
  id: string;
  isPrimary: boolean;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  baseSalary: number;
  unitShare: number;
  paymentForm: string;
  hazardousPct: number | null;
  /** Oklad SalaryRecord dövründən götürülübsə — onun başlanğıcı */
  salaryFrom: Date | null;
}

/**
 * Müqavilənin göstərilən gündəki vəziyyəti; müqavilə həmin gün qüvvədə deyildisə — null.
 * positionPct — vəzifələrin (cari) zərərli şərait faizi: vəzifə dəyişikliyi geri açılanda köhnə vəzifənin faizi götürülür,
 * sonra həmin müqavilə üçün qeydə alınmış faiz dəyişiklikləri də geri açılır.
 */
export function employmentStateAt(e: EmploymentNow, events: FinanceEvent[], day: Date, positionPct: Map<string, number | null>): EmploymentState | null {
  if (day < e.hireDate || (e.terminationDate && day > e.terminationDate)) return null;
  const s: EmploymentState = {
    id: e.id,
    isPrimary: e.isPrimary,
    departmentId: e.departmentId,
    departmentName: e.departmentName,
    positionId: e.positionId,
    positionName: e.positionName,
    baseSalary: e.baseSalary,
    unitShare: e.unitShare,
    paymentForm: e.paymentForm,
    hazardousPct: positionPct.get(e.positionId) ?? null,
    salaryFrom: null,
  };
  for (const ev of events.filter((x) => x.employmentId === e.id && x.effectiveDate > day).sort(newestFirst)) {
    switch (ev.field) {
      case "BASE_SALARY":
        if (ev.oldValue !== null) s.baseSalary = Number(ev.oldValue);
        break;
      case "UNIT_SHARE":
        if (ev.oldValue !== null) s.unitShare = Number(ev.oldValue);
        break;
      case "PAYMENT_FORM":
        s.paymentForm = ev.oldValue ?? "";
        break;
      case "DEPARTMENT":
        if (ev.oldValue) {
          s.departmentId = ev.oldValue;
          s.departmentName = ev.oldLabel ?? ev.oldValue;
        }
        break;
      case "POSITION":
        if (ev.oldValue) {
          s.positionId = ev.oldValue;
          s.positionName = ev.oldLabel ?? ev.oldValue;
          s.hazardousPct = positionPct.get(ev.oldValue) ?? null;
        }
        break;
      case "HAZARDOUS_PCT":
        s.hazardousPct = ev.oldValue === null || ev.oldValue === "" ? null : Number(ev.oldValue);
        break;
    }
  }
  // Oklad dövrləri (SalaryRecord) temporal mənbədir — həmin günü əhatə edən dövr varsa, o götürülür
  const period = e.salaryHistory.find((r) => r.validFrom <= day && (r.validTo === null || r.validTo >= day));
  if (period) {
    s.baseSalary = period.baseSalary;
    s.salaryFrom = period.validFrom;
  }
  return s;
}

/** Şəxs səviyyəli sahələr göstərilən gündə: vergi güzəşti (dəyişikliklər geri açılır), elmi dərəcə / ad — verilmə tarixinə görə */
export function personStateAt(p: PersonNow, events: FinanceEvent[], day: Date) {
  let taxExemptionClause = p.taxExemptionClause;
  for (const ev of events.filter((x) => x.employmentId === null && x.field === "TAX_EXEMPTION" && x.effectiveDate > day).sort(newestFirst)) taxExemptionClause = ev.oldValue;
  return {
    taxExemptionClause,
    degrees: p.degrees.filter((d) => d.awardDate <= day),
    titles: p.titles.filter((t) => t.awardDate <= day),
  };
}

export interface FinanceSnapshot {
  day: Date;
  person: ReturnType<typeof personStateAt>;
  employments: (EmploymentState & { primaryForAllowances: boolean; payroll: PayrollResult })[];
}

/** Göstərilən gündəki tam maliyyə vəziyyəti: hər qüvvədə olan müqavilə üçün oklad, ştat, vəzifə, bölmə və hesablanmış brutto / netto */
export function financialSnapshotAt(p: PersonNow, emps: EmploymentNow[], events: FinanceEvent[], day: Date, positionPct: Map<string, number | null>): FinanceSnapshot {
  const person = personStateAt(p, events, day);
  const states = emps.map((e) => ({ e, s: employmentStateAt(e, events, day, positionPct) })).filter((x): x is { e: EmploymentNow; s: EmploymentState } => x.s !== null);
  const primary = primaryEmploymentIds(states.map(({ e, s }) => ({ id: e.id, personId: "p", isPrimary: s.isPrimary, hireDate: e.hireDate })));
  return {
    day,
    person,
    employments: states.map(({ s }) => ({
      ...s,
      primaryForAllowances: primary.has(s.id),
      payroll: computePayroll({
        baseSalary: s.baseSalary,
        unitShare: s.unitShare,
        isPrimary: primary.has(s.id),
        hazardousAllowancePct: s.hazardousPct,
        taxExemptionClause: person.taxExemptionClause,
        degrees: person.degrees.map((d) => d.degree),
        titles: person.titles.map((t) => t.title),
      }),
    })),
  };
}
