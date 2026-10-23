import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLeaveEntitlement, seniorityExtraDays } from "../src/lib/calc/leave";
import { computePayroll, incomeTax, DEFAULT_PAYROLL_CONFIG } from "../src/lib/calc/payroll";
import { computeSeniority, diff, utcDate } from "../src/lib/calc/seniority";

test("Staja görə əlavə günlər", () => {
  assert.equal(seniorityExtraDays(4.9), 0);
  assert.equal(seniorityExtraDays(5), 2);
  assert.equal(seniorityExtraDays(12), 4);
  assert.equal(seniorityExtraDays(15.1), 6);
});

test("Təqvim fərqi hər iki günü daxil edir", () => {
  assert.deepEqual(diff(utcDate(2020, 0, 1), utcDate(2020, 11, 31)), { years: 1, months: 0, days: 0 });
});

test("Ödənişsiz məzuniyyətin limitdən artıq hissəsi stajdan çıxılır", () => {
  const r = computeSeniority(
    { years: 3, months: 0, days: 0 },
    [{ start: utcDate(2020, 0, 1), end: null }],
    [{ start: utcDate(2020, 5, 1), end: utcDate(2020, 5, 30) }], // 30 gün
    utcDate(2021, 11, 31),
  );
  assert.equal(r.deductedDays, 16); // 30 − 14
  assert.deepEqual(r.service, { years: 2, months: 0, days: 0 });
  assert.deepEqual(r.total, { years: 4, months: 11, days: 14 });
});

test("Məzuniyyət: 3 uşaqlı qadın + 12 il staj", () => {
  const e = computeLeaveEntitlement({
    basicLeaveDays: 30,
    hazardousLeaveDays: 0,
    seniorityYears: 12,
    gender: "FEMALE",
    children: [utcDate(2015, 0, 1), utcDate(2018, 0, 1), utcDate(2020, 0, 1)].map((birthDate) => ({ birthDate, isDisabled: false })),
    quotaBasicLeaveDays: null,
    periodStart: utcDate(2025, 0, 1),
  });
  assert.deepEqual(e, { basic: 30, basicFromQuota: false, seniority: 4, hazardous: 0, motherhood: 5, total: 39 });
});

test("Kvota üzrə əsas məzuniyyət vəzifənin əsas məzuniyyətini əvəz edir", () => {
  const e = computeLeaveEntitlement({
    basicLeaveDays: 21,
    hazardousLeaveDays: 0,
    seniorityYears: 2,
    gender: "MALE",
    children: [],
    quotaBasicLeaveDays: 28,
    periodStart: utcDate(2025, 0, 1),
  });
  assert.equal(e.basic, 28);
  assert.equal(e.basicFromQuota, true);
  assert.equal(e.total, 28);
});

test("Gəlir vergisi pillələri (dövlət sektoru)", () => {
  assert.equal(incomeTax(1000, 0, DEFAULT_PAYROLL_CONFIG.incomeTax).tax, 112); // (1000 − 200) × 14%
  assert.equal(incomeTax(3000, 0, DEFAULT_PAYROLL_CONFIG.incomeTax).tax, 475); // 350 + 500 × 25%
  assert.equal(incomeTax(1000, 100, DEFAULT_PAYROLL_CONFIG.incomeTax).tax, 98); // güzəşt 100
});

test("Əməkhaqqı: brutto → netto", () => {
  const r = computePayroll({ baseSalary: 1000, degrees: ["PHD"], titles: ["DOCENT"], hazardousAllowancePct: null, taxExemptionClause: null });
  assert.equal(r.gross, 1200);
  // vergi (1200−200)×14% = 140; DSMF 36; işsizlik 6; İTS 24
  assert.equal(r.totalDeductions, 206);
  assert.equal(r.net, 994);
});
