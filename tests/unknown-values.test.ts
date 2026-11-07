import assert from "node:assert/strict";
import { test } from "node:test";
import { primaryEmploymentIds } from "../src/lib/calc/payroll";
import { openingSeniority, utcDate, yearsToYmd } from "../src/lib/calc/seniority";
import { registerValid } from "../src/lib/etl/context";
import { computeKpis, type DashboardRow } from "../src/lib/dashboard/filters";
import { missingFields } from "../src/lib/unknown-values";
import { getSheet } from "../src/lib/validation/templates";
import { validateRow } from "../src/lib/validation/validate-row";
import { loadContextFromScratch } from "./helpers";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

/*
 * TZ DAT-02 / MIG-03: «məlum deyil» dəyərləri — boş ≠ sıfır, hesablamalar null-a dözümlüdür.
 */

test("Açılış stajı: kəsim tarixindən sonra işləyirsə artır, işləmirsə artmır; yoxdursa — null", () => {
  const o = { years: 12.5, academicYears: 8, asOf: D("2026-09-28"), source: null, verified: false };
  const today = D("2026-11-07");
  const r = openingSeniority(o, true, today)!;
  assert.deepEqual(yearsToYmd(12.5), { years: 12, months: 6, days: 0 });
  // 29.09 – 07.11 = 1 ay 10 gün
  assert.deepEqual(r.total, { years: 12, months: 7, days: 10 });
  assert.deepEqual(r.academic, { years: 8, months: 1, days: 10 });
  assert.equal(r.note, "mənbə: idxal, yoxlanılmayıb");
  assert.deepEqual(openingSeniority(o, false, today)!.total, { years: 12, months: 6, days: 0 });
  assert.equal(openingSeniority({ ...o, years: null }, true, today), null);
  assert.match(openingSeniority({ ...o, verified: true, source: "idxal 28.09.2026" }, true, today)!.note, /idxal 28\.09\.2026, yoxlanılıb/);
  // Tarixsiz açılış stajı — artmır
  assert.deepEqual(openingSeniority({ ...o, asOf: null }, true, today)!.total, { years: 12, months: 6, days: 0 });
});

test("Əsas iş yeri: işə qəbul tarixi məlum olmayan müqavilə ən sonda seçilir, xəta vermir", () => {
  const ids = primaryEmploymentIds([
    { id: "a", personId: "p", isPrimary: true, hireDate: null },
    { id: "b", personId: "p", isPrimary: true, hireDate: utcDate(2020, 0, 1) },
    { id: "c", personId: "q", isPrimary: true, hireDate: null },
  ]);
  assert.deepEqual([...ids].sort(), ["b", "c"]);
});

test("ƏH fondu: maaşı məlum olmayan müqavilə 0 kimi sayılmır, ayrıca göstərilir", () => {
  const base: DashboardRow = {
    employmentId: "e1",
    personId: "p1",
    code: "1",
    fullName: "A",
    gender: "Kişi",
    category: "İnzibati",
    position: "X",
    degree: "Elmi dərəcəsiz",
    deptPath: [],
    hireDate: null,
    hireYear: null,
    unitShare: 1,
    gross: 0,
    net: 0,
    employerCost: 0,
    onLeave: false,
  };
  const rows: DashboardRow[] = [
    { ...base, salaryUnknown: true },
    { ...base, employmentId: "e2", personId: "p2", gross: 1000, net: 800, employerCost: 1220, hireDate: "2020-01-01T00:00:00.000Z", hireYear: 2020 },
    { ...base, employmentId: "e3", personId: "p3", salaryHidden: true },
  ];
  const k = computeKpis(rows, []);
  assert.equal(k.payrollGross, 1000);
  assert.equal(k.payrollUnknownContracts, 1);
  assert.equal(k.payrollHiddenContracts, 1);
  assert.equal(k.contracts, 3);
});

test("Məlumat tamlığı: çatışmayan sahələr düzgün tapılır", () => {
  const full = { hireDate: D("2020-01-01"), baseSalary: 500, schedule: "5 günlük", paymentForm: "Aylıq oklad" };
  assert.deepEqual(missingFields({ idDocType: "ŞV", idDocNumber: "123", openingSeniorityYears: null, openingSeniorityVerifiedAt: null, employments: [full] }), []);
  assert.deepEqual(
    missingFields({ idDocType: null, idDocNumber: null, openingSeniorityYears: null, openingSeniorityVerifiedAt: null, employments: [{ hireDate: null, baseSalary: null, schedule: null, paymentForm: " " }] }),
    ["hireDate", "baseSalary", "schedule", "paymentForm", "idDoc", "seniority"],
  );
  // Açılış stajı var, amma yoxlanılmayıb
  assert.deepEqual(
    missingFields({ idDocType: "ŞV", idDocNumber: "1", openingSeniorityYears: 10, openingSeniorityVerifiedAt: null, employments: [{ ...full, hireDate: null }] }),
    ["hireDate", "openingUnverified"],
  );
  // Oklad 0 — məlumdur (boş deyil)
  assert.deepEqual(missingFields({ idDocType: "ŞV", idDocNumber: "1", openingSeniorityYears: null, openingSeniorityVerifiedAt: null, employments: [{ ...full, baseSalary: 0 }] }), []);
});

test("İdxal (MIG-03 / DAT-02): qəbul tarixi, oklad, qrafik, ödəniş forması və şəxsiyyət vəsiqəsi boş — xəbərdarlıq, xəta yox", () => {
  const ctx = loadContextFromScratch();
  const dep = validateRow(getSheet("departments1"), { code: "D1", name: "Şöbə", createdOn: "01.01.2000" }, ctx, 2);
  registerValid(ctx, "departments1", dep.parsed);
  const pos = validateRow(
    getSheet("positions"),
    { code: "P1", name: "Mütəxəssis", category: "Qulluqçu", staffCategory: "İnzibati", basicLeaveDays: "21", validFrom: "01.01.2000" },
    ctx,
    2,
  );
  if (pos.parsed) registerValid(ctx, "positions", pos.parsed);
  const person = validateRow(
    getSheet("persons"),
    { code: "E1", lastName: "Əliyev", firstName: "Əli", gender: "K", birthDate: "01.01.1980", fin: "AB12CD3", openingSeniorityYears: "12,5", openingSeniorityAsOf: "28.09.2026" },
    ctx,
    2,
  );
  assert.ok(person.parsed, JSON.stringify(person.issues));
  assert.equal(person.issues.filter((i) => i.severity === "error").length, 0, JSON.stringify(person.issues));
  assert.ok(person.issues.some((i) => i.severity === "warning" && /Şəxsiyyət vəsiqəsi/.test(i.message)));
  assert.equal((person.parsed as { openingSeniorityYears?: number }).openingSeniorityYears, 12.5);
  registerValid(ctx, "persons", person.parsed);

  const emp = validateRow(getSheet("employments"), { personCode: "E1", positionCode: "P1", departmentCode: "D1" }, ctx, 2);
  assert.ok(emp.parsed, JSON.stringify(emp.issues));
  const fields = emp.issues.filter((i) => i.severity === "warning").map((i) => i.field);
  for (const f of ["hireDate", "baseSalary", "schedule", "paymentForm"]) assert.ok(fields.includes(f), `${f} xəbərdarlığı: ${JSON.stringify(emp.issues)}`);
  // Tərs tarix intervalı və səhv tarix formatı isə xətadır (MIG-03)
  const bad = validateRow(getSheet("employments"), { personCode: "E1", positionCode: "P1", departmentCode: "D1", hireDate: "2020-13-01" }, ctx, 3);
  assert.ok(bad.issues.some((i) => i.field === "hireDate" && i.severity === "error"));
  // Mənfi oklad — xəta
  const neg = validateRow(getSheet("employments"), { personCode: "E1", positionCode: "P1", departmentCode: "D1", baseSalary: "-5" }, ctx, 4);
  assert.ok(neg.issues.some((i) => i.field === "baseSalary" && i.severity === "error"));
  // Mövcud olmayan bölmə kodu — xəta
  const noDept = validateRow(getSheet("employments"), { personCode: "E1", positionCode: "P1", departmentCode: "YOX" }, ctx, 5);
  assert.ok(noDept.issues.some((i) => i.field === "departmentCode" && i.severity === "error"));
});
