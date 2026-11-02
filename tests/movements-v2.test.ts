import assert from "node:assert/strict";
import { test } from "node:test";
import { computePayroll } from "../src/lib/calc/payroll";
import { computeSeniority, utcDate } from "../src/lib/calc/seniority";
import { deriveLegacyEvents, employmentStateAt, financialSnapshotAt, formatFinanceValue, type EmploymentNow, type FinanceEvent, type PersonNow } from "../src/lib/finance-history";
import { activeUnpaidLeave, findOverlap, leaveDays, leaveError } from "../src/lib/leave-rules";
import { describeMovement, inferMovementKind, movementKindError, movementKindOf } from "../src/lib/movement-rules";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

// ----------------------------------------------------------------------------
//  Ödənişsiz məzuniyyət: kəsişmə, tarix qaydaları, staj təsiri
// ----------------------------------------------------------------------------

const existing = [
  { id: "a1", type: "SICK", startDate: D("2026-03-01"), endDate: D("2026-03-10") },
  { id: "a2", type: "UNPAID", startDate: D("2026-05-01"), endDate: D("2026-05-20"), cancelledAt: D("2026-05-02") }, // ləğv edilib
];
const ctx = { today: D("2026-11-02"), hireDate: D("2020-09-01"), existing };

test("Məzuniyyət: kəsişən dövr rədd edilir, ləğv edilmiş qeyd kəsişmə sayılmır", () => {
  const overlap = leaveError({ orderDate: D("2026-02-20"), startDate: D("2026-03-10"), endDate: D("2026-03-15") }, ctx);
  assert.equal(overlap?.field, "startDate");
  assert.match(overlap!.message, /xəstəlik.*01\.03\.2026 – 10\.03\.2026/);
  // Bir gün sonra başlayan — kəsişmir
  assert.equal(leaveError({ orderDate: D("2026-02-20"), startDate: D("2026-03-11"), endDate: D("2026-03-15") }, ctx), null);
  // Ləğv edilmiş ö/m dövrü yenidən yazıla bilər
  assert.equal(leaveError({ orderDate: D("2026-04-20"), startDate: D("2026-05-05"), endDate: D("2026-05-10") }, ctx), null);
  assert.equal(findOverlap(D("2026-05-05"), D("2026-05-10"), existing), null);
});

test("Məzuniyyət: bitmə < başlama, gələcək əmr tarixi, işə qəbuldan əvvəl — rədd; gələcək bitmə — icazəli", () => {
  assert.equal(leaveError({ orderDate: D("2026-10-01"), startDate: D("2026-10-10"), endDate: D("2026-10-09") }, ctx)?.field, "endDate");
  assert.equal(leaveError({ orderDate: D("2026-11-03"), startDate: D("2026-11-10"), endDate: D("2026-11-20") }, ctx)?.field, "orderDate");
  assert.equal(leaveError({ orderDate: D("2026-10-01"), startDate: D("2020-08-01"), endDate: D("2020-08-10") }, ctx)?.field, "startDate");
  // Cari məzuniyyət irəli dövrə qədər: əmr keçmişdə, bitmə gələcəkdə
  assert.equal(leaveError({ orderDate: D("2026-10-25"), startDate: D("2026-10-27"), endDate: D("2027-01-15") }, ctx), null);
  assert.equal(leaveDays(D("2026-10-27"), D("2026-10-27")), 1);
});

test("Nişan: bu gün davam edən, ləğv edilməmiş ö/m və ya ö/sm", () => {
  const list = [
    { id: "x", type: "UNPAID", startDate: D("2026-10-01"), endDate: D("2026-12-31"), cancelledAt: D("2026-10-02") },
    { id: "y", type: "SICK", startDate: D("2026-11-01"), endDate: D("2026-11-05") },
    { id: "z", type: "SOCIAL_UNPAID", startDate: D("2026-10-20"), endDate: D("2026-11-30") },
  ];
  assert.equal(activeUnpaidLeave(list, D("2026-11-02"))?.id, "z");
  assert.equal(activeUnpaidLeave(list, D("2026-12-15")), null);
});

test("Staj: ö/m-in iş ilində 14 gündən artıq hissəsi çıxılır; gələcək hissə hələ çıxılmır", () => {
  const initial = { years: 0, months: 0, days: 0 };
  const service = [{ start: D("2020-09-01"), end: null }];
  const asOf = D("2026-11-02");
  const base = computeSeniority(initial, service, [], asOf);
  // 60 günlük ö/m (01.03 – 29.04.2026) — iş ili 01.09.2025 – 31.08.2026
  const withLeave = computeSeniority(initial, service, [{ start: D("2026-03-01"), end: D("2026-04-29") }], asOf);
  assert.equal(withLeave.deductedDays, 60 - 14);
  assert.equal(base.deductedDays, 0);
  assert.ok(withLeave.totalYears < base.totalYears);
  // 14 gün və az — staj dəyişmir
  assert.equal(computeSeniority(initial, service, [{ start: D("2026-03-01"), end: D("2026-03-14") }], asOf).deductedDays, 0);
  // Gələcəyə uzanan məzuniyyət: yalnız asOf-a qədər olan günlər (01.10 – 02.11 = 33 gün → 19 çıxılır)
  assert.equal(computeSeniority(initial, service, [{ start: D("2026-10-01"), end: D("2027-02-01") }], asOf).deductedDays, 33 - 14);
});

// ----------------------------------------------------------------------------
//  Hərəkətin növü: qaydalar və köhnə qeydlər üçün təxmini növ
// ----------------------------------------------------------------------------

const ch = (o: Partial<{ department: boolean; position: boolean; salary: boolean; unitShare: boolean }>) => ({ department: false, position: false, salary: false, unitShare: false, ...o });

test("Vəzifə artımı: yeni vəzifə məcburidir, oklad / bölmə dəyişə bilər", () => {
  assert.equal(movementKindError("PROMOTION", ch({ salary: true }))?.field, "positionId");
  assert.equal(movementKindError("PROMOTION", ch({ position: true, salary: true })), null);
  assert.equal(movementKindError("PROMOTION", ch({ position: true, department: true })), null);
});

test("Növ qaydaları: köçürmə / maaş / ştat dəyişikliyi", () => {
  assert.equal(movementKindError("TRANSFER", ch({ salary: true }))?.field, "departmentId");
  assert.equal(movementKindError("TRANSFER", ch({ department: true })), null);
  assert.equal(movementKindError("SALARY_CHANGE", ch({ salary: true, unitShare: true })), null);
  assert.equal(movementKindError("SALARY_CHANGE", ch({ position: true, salary: true }))?.field, "movementKind");
  assert.equal(movementKindError("SALARY_CHANGE", ch({ unitShare: true }))?.field, "baseSalary");
  assert.equal(movementKindError("UNIT_CHANGE", ch({ unitShare: true, salary: true })), null);
  assert.equal(movementKindError("UNIT_CHANGE", ch({ salary: true }))?.field, "unitShare");
  assert.equal(movementKindError("UNIT_CHANGE", ch({ department: true, unitShare: true }))?.field, "movementKind");
});

test("Köhnə (növsüz) qeydlər: növ from/to-ya görə təxmin edilir, mətn dəyişmir", () => {
  const none = { fromDepartment: null, toDepartment: null, fromPosition: null, toPosition: null, fromSalary: null, toSalary: null, fromUnitShare: null, toUnitShare: null };
  assert.equal(inferMovementKind(ch({ department: true, salary: true })), "TRANSFER");
  assert.equal(inferMovementKind(ch({ unitShare: true, salary: true })), "UNIT_CHANGE");
  assert.equal(inferMovementKind(ch({ salary: true })), "SALARY_CHANGE");
  const promo = { ...none, fromPosition: "Baş müəllim", toPosition: "Dosent", fromSalary: 900, toSalary: 1100 };
  assert.equal(describeMovement(promo).kind, "Köçürmə, oklad dəyişikliyi");
  assert.equal(describeMovement(promo, "PROMOTION").kind, "Vəzifə artımı");
  assert.equal(movementKindOf(promo, null), "TRANSFER");
  assert.equal(movementKindOf(promo, "PROMOTION"), "PROMOTION");
});

// ----------------------------------------------------------------------------
//  Maliyyə tarixçəsi: «tarixə görə baxış» və köhnə qeydlərdən bərpa
// ----------------------------------------------------------------------------

const pct = new Map<string, number | null>([
  ["pos-teacher", null],
  ["pos-docent", null],
  ["pos-lab", 10],
]);

/** 2020-də müəllim (800), 01.03.2024 köhnə hərəkət (növsüz) ilə dosent 1000, idxal 2025-01-01 oklad 1100 (SalaryRecord), 2026-06-01 vəzifə artımı (FinancialChange) — laborant, 1300, 0.5 ştat */
const emp: EmploymentNow = {
  id: "e1",
  hireDate: D("2020-09-01"),
  terminationDate: null,
  isPrimary: true,
  departmentId: "dep-b",
  departmentName: "B kafedrası",
  positionId: "pos-lab",
  positionName: "Laboratoriya müdiri",
  baseSalary: 1300,
  unitShare: 0.5,
  paymentForm: "Aylıq oklad",
  salaryHistory: [
    { baseSalary: 800, validFrom: D("2020-09-01"), validTo: D("2024-02-29") },
    { baseSalary: 1000, validFrom: D("2024-03-01"), validTo: D("2024-12-31") },
    { baseSalary: 1100, validFrom: D("2025-01-01"), validTo: D("2026-05-31") },
    { baseSalary: 1300, validFrom: D("2026-06-01"), validTo: null },
  ],
  movements: [
    {
      id: "m-old",
      orderNumber: "15-K",
      orderDate: D("2024-02-25"),
      effectiveDate: D("2024-03-01"),
      fromDepartmentId: "dep-a",
      fromDepartment: "A kafedrası",
      toDepartmentId: "dep-b",
      toDepartment: "B kafedrası",
      fromPositionId: "pos-teacher",
      fromPosition: "Müəllim",
      toPositionId: "pos-docent",
      toPosition: "Dosent",
      fromSalary: 800,
      toSalary: 1000,
      fromUnitShare: null,
      toUnitShare: null,
      createdAt: D("2024-02-26"),
      by: "HR 1",
    },
    {
      id: "m-new",
      orderNumber: "77-K",
      orderDate: D("2026-05-28"),
      effectiveDate: D("2026-06-01"),
      fromDepartmentId: null,
      fromDepartment: null,
      toDepartmentId: null,
      toDepartment: null,
      fromPositionId: "pos-docent",
      fromPosition: "Dosent",
      toPositionId: "pos-lab",
      toPosition: "Laboratoriya müdiri",
      fromSalary: 1100,
      toSalary: 1300,
      fromUnitShare: 1,
      toUnitShare: 0.5,
      createdAt: D("2026-05-28"),
      by: "HR 1",
    },
  ],
};
const ev = (o: Partial<FinanceEvent> & Pick<FinanceEvent, "field" | "oldValue" | "newValue" | "effectiveDate">): FinanceEvent => ({
  key: `${o.field}-${o.effectiveDate.toISOString()}`,
  employmentId: "e1",
  oldLabel: null,
  newLabel: null,
  source: "MOVEMENT",
  orderNumber: "77-K",
  orderDate: D("2026-05-28"),
  by: "HR 1",
  createdAt: D("2026-05-28"),
  derived: false,
  ...o,
});
// Yeni hərəkət artıq FinancialChange-ə yazılıb (movementId = m-new); ödəniş forması redaktə ilə dəyişib
const explicit: FinanceEvent[] = [
  ev({ field: "POSITION", oldValue: "pos-docent", newValue: "pos-lab", oldLabel: "Dosent", newLabel: "Laboratoriya müdiri", effectiveDate: D("2026-06-01") }),
  ev({ field: "BASE_SALARY", oldValue: "1100.00", newValue: "1300.00", effectiveDate: D("2026-06-01") }),
  ev({ field: "UNIT_SHARE", oldValue: "1.00", newValue: "0.50", effectiveDate: D("2026-06-01") }),
  ev({ field: "HAZARDOUS_PCT", oldValue: null, newValue: "10", effectiveDate: D("2026-06-01") }),
  ev({ field: "PAYMENT_FORM", oldValue: "Saatlıq", newValue: "Aylıq oklad", effectiveDate: D("2026-08-01"), source: "EDIT", orderNumber: null, orderDate: null, createdAt: D("2026-08-01") }),
];
const linked = new Set(["m-new"]);
const person: PersonNow = {
  taxExemptionClause: "102.2.3",
  degrees: [{ degree: "PHD", name: "Fəlsəfə doktoru", awardDate: D("2023-05-10") }],
  titles: [],
};

test("Bərpa: bağlı olmayan köhnə hərəkət və izah olunmayan SalaryRecord keçidi — idempotent", () => {
  const derived = deriveLegacyEvents([emp], explicit, linked);
  // m-old: bölmə, vəzifə, oklad; SalaryRecord 2025-01-01 (1000 → 1100) — idxal; 2024-03-01 və 2026-06-01 artıq izah olunub
  assert.deepEqual(derived.map((e) => `${e.field}@${e.effectiveDate.toISOString().slice(0, 10)}:${e.source}`).sort(), [
    "BASE_SALARY@2024-03-01:MOVEMENT",
    "BASE_SALARY@2025-01-01:SALARY_RECORD",
    "DEPARTMENT@2024-03-01:MOVEMENT",
    "POSITION@2024-03-01:MOVEMENT",
  ]);
  assert.deepEqual(deriveLegacyEvents([emp], explicit, linked), derived);
  assert.ok(derived.every((e) => e.derived));
});

test("Tarixə görə baxış: keçmiş tarix köhnə okladı, vəzifəni, bölməni və ştatı göstərir", () => {
  const events = [...explicit, ...deriveLegacyEvents([emp], explicit, linked)];
  const at = (s: string) => employmentStateAt(emp, events, D(s), pct);
  assert.equal(at("2019-01-01"), null); // işə qəbuldan əvvəl
  const y2022 = at("2022-06-15")!;
  assert.deepEqual([y2022.baseSalary, y2022.positionName, y2022.departmentName, y2022.unitShare, y2022.paymentForm, y2022.hazardousPct], [800, "Müəllim", "A kafedrası", 1, "Saatlıq", null]);
  const y2024 = at("2024-03-01")!; // hərəkətin qüvvəyə mindiyi gün — yeni dəyərlər
  assert.deepEqual([y2024.baseSalary, y2024.positionName, y2024.departmentName], [1000, "Dosent", "B kafedrası"]);
  assert.equal(at("2025-06-01")!.baseSalary, 1100); // idxal ilə dəyişən oklad (SalaryRecord)
  const y2026 = at("2026-07-01")!;
  assert.deepEqual([y2026.baseSalary, y2026.positionName, y2026.unitShare, y2026.hazardousPct, y2026.paymentForm], [1300, "Laboratoriya müdiri", 0.5, 10, "Saatlıq"]);
  assert.equal(at("2026-11-02")!.paymentForm, "Aylıq oklad");
});

test("Tarixə görə baxış: SalaryRecord olmayan müqavilədə oklad hərəkətlərdən geri açılır", () => {
  const bare: EmploymentNow = { ...emp, salaryHistory: [] };
  const events = [...explicit, ...deriveLegacyEvents([bare], explicit, linked)];
  assert.equal(employmentStateAt(bare, events, D("2022-01-01"), pct)!.baseSalary, 800);
  assert.equal(employmentStateAt(bare, events, D("2025-06-01"), pct)!.baseSalary, 1100); // sonrakı dəyişikliyin «köhnə» dəyəri
  assert.equal(employmentStateAt(bare, events, D("2024-03-01"), pct)!.baseSalary, 1100);
});

test("Tarixə görə baxış: brutto / netto həmin günün dəyərləri ilə hesablanır", () => {
  const events = [...explicit, ...deriveLegacyEvents([emp], explicit, linked)];
  const s2022 = financialSnapshotAt(person, [emp], events, D("2022-06-15"), pct);
  // 2022: elmi dərəcə hələ yox (2023-də verilib), oklad 800, tam ştat
  assert.equal(s2022.employments[0]!.payroll.gross, computePayroll({ baseSalary: 800, degrees: [], titles: [], hazardousAllowancePct: null, taxExemptionClause: "102.2.3", unitShare: 1 }).gross);
  assert.equal(s2022.employments[0]!.payroll.gross, 800);
  const s2026 = financialSnapshotAt(person, [emp], events, D("2026-07-01"), pct);
  const expected = computePayroll({ baseSalary: 1300, degrees: ["PHD"], titles: [], hazardousAllowancePct: 10, taxExemptionClause: "102.2.3", unitShare: 0.5, isPrimary: true });
  assert.equal(s2026.employments[0]!.payroll.gross, expected.gross); // 1300 + 50 (PHD × 0.5) + 130 (10%)
  assert.equal(expected.gross, 1480);
  assert.equal(s2026.employments[0]!.payroll.net, expected.net);
});

test("Vergi güzəşti şəxs səviyyəsində geri açılır; göstərmə formatı", () => {
  const tax: FinanceEvent = ev({ employmentId: null, field: "TAX_EXEMPTION", oldValue: null, newValue: "102.2.3", effectiveDate: D("2025-01-01"), source: "IMPORT", orderNumber: null, orderDate: null });
  const events = [tax, ...explicit, ...deriveLegacyEvents([emp], explicit, linked)];
  assert.equal(financialSnapshotAt(person, [emp], events, D("2024-06-01"), pct).person.taxExemptionClause, null);
  assert.equal(financialSnapshotAt(person, [emp], events, D("2025-06-01"), pct).person.taxExemptionClause, "102.2.3");
  assert.equal(formatFinanceValue("BASE_SALARY", "1300.00", null), "1\u00A0300,00\u00A0₼");
  assert.equal(formatFinanceValue("UNIT_SHARE", "0.50", null), "0,50");
  assert.equal(formatFinanceValue("HAZARDOUS_PCT", "12.5", null), "12,50%");
  assert.equal(formatFinanceValue("HAZARDOUS_PCT", "10", null), "10%");
  assert.equal(formatFinanceValue("HAZARDOUS_PCT", null, null), "—");
  assert.equal(formatFinanceValue("POSITION", "pos-lab", "Laboratoriya müdiri"), "Laboratoriya müdiri");
  assert.ok(utcDate(2026, 0, 1) instanceof Date);
});
