import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketize, computeKpis, type DashboardRow } from "../src/lib/dashboard/filters";
import { describeMovement } from "../src/lib/movement-rules";
import {
  canEditSalary,
  canSeeSalary,
  hiddenFor,
  isSalaryPrivileged,
  lockedFor,
  lockedSalaryInput,
  maskMovementSalary,
  maskStagingRow,
  SALARY_LOCKED_MESSAGE,
  STAGING_SALARY_FIELDS,
  type SalaryViewer,
} from "../src/lib/salary-privacy";

// ----------------------------------------------------------------------------
//  Matris: kim × kimin maaşı
// ----------------------------------------------------------------------------

const HR_A = "pA"; // hrA hesabına bağlı şəxs
const HR_B = "pB"; // hrB hesabına bağlı şəxs
const BOSS = "pBoss"; // hrBoss (imtiyazlı) hesabına bağlı şəxs
const KADR = "pK"; // məxfi bölmədə işləyən, hesabı olmayan əməkdaş
const PLAIN = "pX"; // adi əməkdaş
const restricted = new Set([HR_A, HR_B, BOSS, KADR]);

const viewers: Record<string, SalaryViewer> = {
  root: { role: "ROOT", personId: null, canViewRestrictedSalaries: false },
  hrBoss: { role: "HR", personId: BOSS, canViewRestrictedSalaries: true },
  hrA: { role: "HR", personId: HR_A, canViewRestrictedSalaries: false },
  hrPlain: { role: "HR", personId: null, canViewRestrictedSalaries: false },
  deptHead: { role: "DEPT_HEAD", personId: null, canViewRestrictedSalaries: false },
  // Şöbə rəhbərinə bayraq səhvən verilsə də imtiyaz vermir
  deptHeadFlag: { role: "DEPT_HEAD", personId: null, canViewRestrictedSalaries: true },
};

// [görür, dəyişir] — sətir: istifadəçi, sütun: şəxs
const EXPECT: Record<string, Record<string, [boolean, boolean]>> = {
  root: { [HR_A]: [true, true], [HR_B]: [true, true], [BOSS]: [true, true], [KADR]: [true, true], [PLAIN]: [true, true] },
  hrBoss: { [HR_A]: [true, true], [HR_B]: [true, true], [BOSS]: [true, true], [KADR]: [true, true], [PLAIN]: [true, true] },
  hrA: { [HR_A]: [true, false], [HR_B]: [false, false], [BOSS]: [false, false], [KADR]: [false, false], [PLAIN]: [true, true] },
  hrPlain: { [HR_A]: [false, false], [HR_B]: [false, false], [BOSS]: [false, false], [KADR]: [false, false], [PLAIN]: [true, true] },
  deptHead: { [HR_A]: [false, false], [HR_B]: [false, false], [BOSS]: [false, false], [KADR]: [false, false], [PLAIN]: [true, true] },
  deptHeadFlag: { [HR_A]: [false, false], [HR_B]: [false, false], [BOSS]: [false, false], [KADR]: [false, false], [PLAIN]: [true, true] },
};

test("Maaş məxfiliyi: canSeeSalary / canEditSalary matrisi (root, imtiyazlı HR, adi HR, özü, şöbə rəhbəri × məxfi / adi)", () => {
  for (const [who, row] of Object.entries(EXPECT)) {
    for (const [person, [see, edit]] of Object.entries(row)) {
      assert.equal(canSeeSalary(viewers[who]!, person, restricted), see, `${who} görür ${person}`);
      assert.equal(canEditSalary(viewers[who]!, person, restricted), edit, `${who} dəyişir ${person}`);
    }
  }
  assert.equal(isSalaryPrivileged(viewers.deptHeadFlag!), false);
  // Tək şəxs üçün boolean forması da eyni
  assert.equal(canSeeSalary(viewers.hrA!, HR_B, true), false);
  assert.equal(canSeeSalary(viewers.hrA!, HR_A, true), true);
  assert.equal(canEditSalary(viewers.hrA!, HR_A, true), false);
});

test("Maaş məxfiliyi: gizlədilən və kilidli dəstlər", () => {
  assert.deepEqual([...hiddenFor(viewers.hrA!, restricted)].sort(), [BOSS, HR_B, KADR].sort());
  assert.deepEqual([...lockedFor(viewers.hrA!, restricted)].sort(), [BOSS, HR_A, HR_B, KADR].sort());
  assert.equal(hiddenFor(viewers.root!, restricted).size, 0);
  assert.equal(lockedFor(viewers.hrBoss!, restricted).size, 0);
  // Özü məxfi siyahıda olmasa da (məs. bağlantı sonradan) — dəyişə bilmir
  assert.ok(lockedFor(viewers.hrA!, new Set()).has(HR_A));
  // Mənbə dəst dəyişmir
  assert.equal(restricted.size, 4);
});

test("Maaş məxfiliyi: formadan BOŞ gələn oklad mövcudu silmir/sıfırlamır; dəyər göndərilibsə rədd (bərabər olsa da — oracle yoxdur)", () => {
  assert.deepEqual(lockedSalaryInput(undefined, 1234.56), { ok: true, value: 1234.56 });
  assert.deepEqual(lockedSalaryInput("", 1234.56), { ok: true, value: 1234.56 });
  assert.deepEqual(lockedSalaryInput("   ", 1234.56), { ok: true, value: 1234.56 });
  assert.deepEqual(lockedSalaryInput(null, 1234.56), { ok: true, value: 1234.56 });
  assert.deepEqual(lockedSalaryInput("0", 1234.56), { ok: false, error: SALARY_LOCKED_MESSAGE });
  assert.deepEqual(lockedSalaryInput("1234.56", 1234.56), { ok: false, error: SALARY_LOCKED_MESSAGE });
  assert.deepEqual(lockedSalaryInput("9999", 1234.56), { ok: false, error: SALARY_LOCKED_MESSAGE });
});

test("Maaş məxfiliyi: kadr hərəkətində oklad gizlədilir, «oklad: məxfi» qalır, növ düzgün", () => {
  const m = { fromDepartment: null, toDepartment: null, fromPosition: null, toPosition: null, fromSalary: 1000, toSalary: 1234.56, fromUnitShare: null, toUnitShare: null };
  const open = describeMovement(maskMovementSalary(m, false));
  assert.match(open.details, /1 234\.56 ₼/);
  const masked = maskMovementSalary(m, true);
  assert.equal(masked.fromSalary, null);
  assert.equal(masked.toSalary, null);
  assert.equal(masked.salaryMasked, true);
  const t = describeMovement(masked);
  assert.equal(t.kind, "Oklad dəyişikliyi");
  assert.equal(t.details, "oklad: məxfi");
  assert.doesNotMatch(JSON.stringify(masked) + t.details, /1234|1 234|1000/);
  // Oklad dəyişməyibsə — «məxfi» işarəsi də yoxdur
  const transfer = maskMovementSalary({ ...m, fromSalary: null, toSalary: null, fromDepartment: "A", toDepartment: "B" }, true);
  assert.equal(transfer.salaryMasked, false);
  assert.equal(describeMovement(transfer).details, "A → B");
});

test("Maaş məxfiliyi: idxal sətrində maaş xanası və diapazon mətni gizlədilir", () => {
  const row = {
    id: "r1",
    data: { personCode: "ASU-1", departmentCode: "RK-01", baseSalary: "1234.56", schedule: "5 gün" },
    errors: [
      { field: "baseSalary", message: "Oklad ştat diapazonundan kənardır (1000–1500 AZN)" },
      { field: "schedule", message: "başqa xəta" },
    ],
  };
  const m = maskStagingRow(row, STAGING_SALARY_FIELDS.employments!);
  assert.equal(m.data.baseSalary, "");
  assert.equal(m.data.schedule, "5 gün");
  assert.deepEqual(m.masked, ["baseSalary"]);
  assert.doesNotMatch(JSON.stringify(m), /1234|1000|1500/);
  assert.equal(m.errors[1]!.message, "başqa xəta");
  // Ştat vərəqi: hər iki maaş sahəsi
  const st = maskStagingRow({ data: { departmentCode: "RK-01", minSalary: "700", maxSalary: "900" }, errors: [] }, STAGING_SALARY_FIELDS.staffing!);
  assert.deepEqual(st.masked, ["minSalary", "maxSalary"]);
  assert.doesNotMatch(JSON.stringify(st), /700|900/);
});

const row = (personId: string, category: string, dept: string, gross: number, salaryHidden = false): DashboardRow => ({
  employmentId: `${personId}-${dept}`,
  personId,
  code: personId,
  fullName: personId,
  gender: "Kişi",
  category,
  position: "x",
  degree: "Elmi dərəcəsiz",
  deptPath: [{ id: dept, name: dept, level: 1 }],
  hireDate: "2020-01-01T00:00:00.000Z",
  hireYear: 2020,
  unitShare: 1,
  gross,
  net: gross * 0.8,
  employerCost: gross * 1.2,
  salaryHidden,
  onLeave: false,
});

test("Maaş məxfiliyi: idarə panelində məxfi maaş heç bir cəmə (ümumi, kateqoriya, bölmə) daxil deyil — çıxma ilə hesablanmır", () => {
  // Server gizlədilən sətirdə 0 göndərir (data.ts); burada aqreqasiyaların ardıcıllığı yoxlanılır
  const rows = [row("a", "İnzibati", "HR", 0, true), row("b", "İnzibati", "IT", 500), row("c", "Professor-müəllim", "FAC", 1500)];
  const k = computeKpis(rows, []);
  assert.equal(k.payrollGross, 2000);
  assert.equal(k.payrollHiddenContracts, 1);
  assert.equal(k.headcount, 3);
  const byCat = bucketize(rows, (r) => r.category);
  const byDept = bucketize(rows, (r) => r.deptPath[0]!.id);
  const sum = (bs: { gross: number }[]) => bs.reduce((s, b) => s + b.gross, 0);
  // Ümumi − bölgülərin cəmi = 0 → gizli şəxsin maaşı tapılmır
  assert.equal(k.payrollGross - sum(byCat), 0);
  assert.equal(k.payrollGross - sum(byDept), 0);
  assert.equal(byDept.find((b) => b.key === "HR")!.gross, 0);
  assert.equal(byDept.find((b) => b.key === "HR")!.count, 1);
});
