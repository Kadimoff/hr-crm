import assert from "node:assert/strict";
import { test } from "node:test";
import { registerValid } from "../src/lib/etl/context";
import { parseAzDate } from "../src/lib/validation/primitives";
import { getSheet } from "../src/lib/validation/templates";
import { validateRow } from "../src/lib/validation/validate-row";
import { loadContextFromScratch } from "./helpers";

const D = (s: string) => parseAzDate(s)!;

test("DD.MM.YYYY: yanlış təqvim tarixi və il formatı rədd edilir", () => {
  assert.equal(parseAzDate("31.02.2024"), null);
  assert.equal(parseAzDate("2024-02-01"), null);
  assert.equal(parseAzDate("2005"), null); // 4 rəqəmli il Excel seriya nömrəsi kimi qəbul edilmir
  assert.deepEqual(parseAzDate("29.02.2024"), new Date(Date.UTC(2024, 1, 29)));
  // Formatsız hüceyrə: Excel seriya nömrəsi
  assert.deepEqual(parseAzDate("45658"), new Date(Date.UTC(2025, 0, 1)));
});

const person = {
  code: "E001",
  lastName: "Məmmədov",
  firstName: "Əli",
  patronymic: "Vəli oğlu",
  gender: "K",
  birthDate: "12.05.1985",
  idDocType: "Şəxsiyyət vəsiqəsi",
  idDocSeries: "AA",
  idDocNumber: "1234567",
  fin: "5abc12k",
};

test("FİN kod: 7 simvol tələbi semantik səviyyədə xəta verir", () => {
  const ctx = loadContextFromScratch();
  const bad = validateRow(getSheet("persons"), { ...person, fin: "5ABC12" }, ctx, 3);
  assert.equal(bad.parsed, null);
  const issue = bad.issues.find((i) => i.field === "fin");
  assert.ok(issue);
  assert.equal(issue.tier, "semantic");
  assert.match(issue.message, /7 simvol/);

  const ok = validateRow(getSheet("persons"), person, ctx, 4);
  assert.ok(ok.parsed);
  assert.equal((ok.parsed as { fin: string; gender: string }).fin, "5ABC12K");
  assert.equal((ok.parsed as { gender: string }).gender, "MALE");
});

test("Tarix formatı səhvdirsə sintaktik xəta", () => {
  const r = validateRow(getSheet("persons"), { ...person, birthDate: "1985/05/12" }, loadContextFromScratch(), 3);
  assert.equal(r.issues[0]?.tier, "syntactic");
  assert.equal(r.issues[0]?.field, "birthDate");
});

test("Məzuniyyət qalığı: həm +1 il (təlimat), həm +1 il − 1 gün qəbul olunur, natamam il rədd edilir", () => {
  const ctx = loadContextFromScratch();
  const def = getSheet("leaveBasic");
  const ok1 = validateRow(def, { personCode: "X", periodStart: "01.08.2021", periodEnd: "01.08.2022", days: "10" }, ctx, 2);
  const ok2 = validateRow(def, { personCode: "X", periodStart: "01.08.2022", periodEnd: "31.07.2023", days: "0" }, ctx, 3);
  assert.equal(ok1.issues.filter((i) => i.tier !== "reference").length, 0);
  assert.equal(ok2.issues.filter((i) => i.tier !== "reference").length, 0);
  const bad = validateRow(def, { personCode: "X", periodStart: "15.03.2023", periodEnd: "01.02.2024", days: "5" }, ctx, 4);
  assert.equal(bad.issues.find((i) => i.field === "periodEnd")?.suggestion, "15.03.2024");
  const late = validateRow(def, { personCode: "X", periodStart: "01.06.2024", periodEnd: "01.06.2025", days: "5" }, ctx, 5);
  assert.match(late.issues.find((i) => i.field === "periodEnd")?.message ?? "", /01\.04\.2025/);
});

test("Ailə: qeydiyyat tarixi qaydası (işə qəbuldan əvvəl doğulub → qəbul tarixi)", () => {
  const ctx = loadContextFromScratch();
  registerValid(ctx, "persons", { code: "E001", birthDate: D("12.05.1985"), gender: "FEMALE", fin: "5ABC12K" });
  registerValid(ctx, "employments", { personCode: "E001", positionCode: "P1", departmentCode: "D1", hireDate: D("01.09.2015") });
  const def = getSheet("family");
  const before = validateRow(def, { personCode: "E001", fullName: "Aysel", relation: "qız", birthDate: "10.10.2012", registrationDate: "10.10.2012" }, ctx, 2);
  assert.equal(before.issues[0]?.suggestion, "01.09.2015");
  const after = validateRow(def, { personCode: "E001", fullName: "Murad", relation: "Oğul", birthDate: "03.03.2018", registrationDate: "03.03.2018" }, ctx, 3);
  assert.deepEqual(after.issues, []);
});

test("İstinad: mövcud olmayan vəzifə və ştat limiti (kəsr ştat yuxarı yuvarlaqlaşdırılır)", () => {
  const ctx = loadContextFromScratch();
  registerValid(ctx, "departments1", { code: "D1", name: "D", level: 1, createdOn: D("01.01.2000") });
  registerValid(ctx, "positions", { code: "P1", name: "Dosent", validFrom: D("01.01.2000"), basicLeaveDays: 56 });
  for (const c of ["E1", "E2", "E3"]) registerValid(ctx, "persons", { code: c, birthDate: D("01.01.1980"), gender: "MALE", fin: `AAAAAA${c.at(-1)}` });
  registerValid(ctx, "staffing", { departmentCode: "D1", positionCode: "P1", unitCount: 1.5, minSalary: 500, maxSalary: 900, periodDate: D("01.01.2024") });
  const def = getSheet("employments");
  const base = { departmentCode: "D1", hireDate: "01.02.2024", schedule: "5 günlük", paymentForm: "Aylıq", baseSalary: "800" };

  const missing = validateRow(def, { ...base, personCode: "E1", positionCode: "POS-09" }, ctx, 2);
  assert.ok(missing.issues.some((i) => i.tier === "reference" && i.message.includes('"POS-09" tapılmadı')));

  const errors = (r: ReturnType<typeof validateRow>) => r.issues.filter((i) => i.severity === "error");
  assert.equal(errors(validateRow(def, { ...base, personCode: "E1", positionCode: "P1" }, ctx, 3)).length, 0);
  assert.equal(errors(validateRow(def, { ...base, personCode: "E2", positionCode: "P1" }, ctx, 4)).length, 0); // 1.5 → 2 nəfər
  const third = validateRow(def, { ...base, personCode: "E3", positionCode: "P1" }, ctx, 5);
  assert.ok(third.issues.some((i) => i.message.startsWith("Ştat limiti aşılır")));
});

test("Bölmə ağacı: 3-cü mərhələ bölməsi 2-ci mərhələyə tabe olmalıdır", () => {
  const ctx = loadContextFromScratch();
  registerValid(ctx, "departments1", { code: "F1", name: "F", level: 1, createdOn: D("01.01.2000") });
  const r = validateRow(getSheet("departments3"), { code: "K1", name: "Lab", parentCode: "F1", createdOn: "01.01.2001" }, ctx, 2);
  assert.ok(r.issues.some((i) => i.field === "parentCode" && i.message.includes("2-ci mərhələ")));
  const ok = validateRow(getSheet("departments2"), { code: "K2", name: "Kafedra", parentCode: "F1", isChair: "Bəli", createdOn: "01.01.2001" }, ctx, 2);
  assert.deepEqual(ok.issues, []);
  assert.equal((ok.parsed as { level: number }).level, 2);
});

test("İşdə iştirak etməmə: vərəqə görə səbəb kodları (ö/sm, sm, ö/m)", () => {
  const ctx = loadContextFromScratch();
  const social = validateRow(getSheet("absencesSocial"), { personCode: "X", type: "ö/sm", startDate: "01.09.2024", endDate: "10.09.2024" }, ctx, 2);
  assert.equal((social.parsed as { type: string }).type, "SOCIAL_UNPAID");
  const wrong = validateRow(getSheet("absencesUnpaid"), { personCode: "X", type: "sm", startDate: "01.09.2024", endDate: "10.09.2024" }, ctx, 2);
  assert.equal(wrong.parsed, null);
  const outside = validateRow(getSheet("absencesSick"), { personCode: "X", type: "xəstəlik", startDate: "01.09.2023", endDate: "05.09.2023" }, ctx, 2);
  assert.ok(outside.issues.some((i) => i.severity === "warning" && i.message.includes("dövründən")));
});

test("Elmi dərəcə və ad tam mətndən tanınır", () => {
  const ctx = loadContextFromScratch();
  const deg = validateRow(getSheet("degrees"), { personCode: "X", degreeName: "İqtisad üzrə fəlsəfə doktoru", awardDate: "20.12.2012" }, ctx, 2);
  assert.ok(deg.parsed);
  const bad = validateRow(getSheet("titles"), { personCode: "X", titleName: "Baş müəllim", awardDate: "20.12.2012" }, ctx, 2);
  assert.equal(bad.parsed, null);
});
