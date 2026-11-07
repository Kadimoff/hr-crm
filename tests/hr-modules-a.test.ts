import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { streamWorkbook } from "../src/lib/etl/parser";
import { registerValid } from "../src/lib/etl/context";
import {
  closeBlockers,
  compareDepartments,
  dueChanges,
  levelError,
  MAX_DEPT_LEVEL,
  moveError,
  ordinal,
  structureAsOf,
  syncKindFlags,
  type ChangeRecord,
  type DeptSnapshot,
} from "../src/lib/org-structure";
import { ackTargets, applicableJobDescription, assertEditable, inForce, isEditable, nextVersion, openDraft, RegulationError, reviewState, supersede, transitionError, type JdLite } from "../src/lib/regulations";
import { DEPARTMENT_SHEETS, getSheet, TEMPLATES } from "../src/lib/validation/templates";
import { validateRow } from "../src/lib/validation/validate-row";
import { loadContextFromScratch } from "./helpers";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

// ----------------------------------------------------------------------------
//  Struktur: 6 səviyyə
// ----------------------------------------------------------------------------

test("Struktur 6 səviyyəyədək: şablonda 6 vərəq, 5-ci və 6-cı könüllüdür, 7-ci səviyyə rədd", () => {
  assert.equal(MAX_DEPT_LEVEL, 6);
  assert.equal(DEPARTMENT_SHEETS.length, 6);
  assert.deepEqual(TEMPLATES.departments.sheets, [...DEPARTMENT_SHEETS]);
  assert.equal(getSheet("departments4").optional, false);
  assert.equal(getSheet("departments5").optional, true);
  assert.equal(getSheet("departments6").optional, true);
  assert.deepEqual(getSheet("departments6").sheetNames?.[0], "6-cı mərhələ struktur bölmələri");
  assert.equal(ordinal(3), "3-cü");
  assert.equal(levelError(6), null);
  assert.match(levelError(7)!, /ən çox 6/);

  const ctx = loadContextFromScratch();
  let parent: string | undefined;
  for (let lvl = 1; lvl <= 6; lvl++) {
    const code = `L${lvl}`;
    const r = validateRow(getSheet(`departments${lvl}` as "departments1"), { code, name: `Səviyyə ${lvl}`, ...(parent ? { parentCode: parent } : {}), createdOn: "01.01.2020" }, ctx, lvl + 1);
    assert.ok(r.parsed, `səviyyə ${lvl} sətri oxundu`);
    assert.equal(r.issues.filter((i) => i.severity === "error").length, 0, `səviyyə ${lvl}: ${JSON.stringify(r.issues)}`);
    registerValid(ctx, `departments${lvl}` as "departments1", r.parsed);
    parent = code;
  }
  // 6-cı vərəqdə 4-cü səviyyəyə tabe bölmə — səviyyə uyğunsuzluğu
  const bad = validateRow(getSheet("departments6"), { code: "X", name: "X", parentCode: "L4", createdOn: "01.01.2020" }, ctx, 9);
  assert.ok(bad.issues.some((i) => i.field === "parentCode" && i.severity === "error"));
});

test("Tabelik dəyişikliyi: dairəvi tabelik və 6 səviyyədən dərin alt ağac rədd edilir", () => {
  const subtree = new Set(["A", "A1", "A2"]);
  assert.match(moveError({ id: "A", newParentId: "A2", newParentLevel: 3, subtreeIds: subtree, subtreeDepth: 2 })!, /dairəvi/);
  assert.equal(moveError({ id: "A", newParentId: "B", newParentLevel: 4, subtreeIds: subtree, subtreeDepth: 2 }), null); // 5 + 1 = 6
  assert.match(moveError({ id: "A", newParentId: "B", newParentLevel: 5, subtreeIds: subtree, subtreeDepth: 2 })!, /ən çox 6/);
  assert.equal(moveError({ id: "A", newParentId: null, newParentLevel: 0, subtreeIds: subtree, subtreeDepth: 6 }), null);
});

test("Növ və köhnə bayraqlar sinxrondur; sıralama sortOrder → kod (rəqəmlər ədəd kimi)", () => {
  assert.deepEqual(syncKindFlags({ kind: "FAKULTE" }), { kind: "FAKULTE", isFaculty: true, isChair: false });
  assert.deepEqual(syncKindFlags({ kind: "SOBE", isFaculty: true }), { kind: "SOBE", isFaculty: false, isChair: false });
  assert.deepEqual(syncKindFlags({ isChair: true }), { kind: "KAFEDRA", isFaculty: false, isChair: true });
  assert.deepEqual(syncKindFlags({}), { kind: null, isFaculty: false, isChair: false });
  const list = [
    { code: "P1-F10", sortOrder: null },
    { code: "P1-F2", sortOrder: null },
    { code: "Z", sortOrder: 1 },
  ].sort(compareDepartments);
  assert.deepEqual(list.map((x) => x.code), ["Z", "P1-F2", "P1-F10"]);
});

// ----------------------------------------------------------------------------
//  İdxal: köhnə şablon (4 vərəq, yeni sütunlar olmadan) dəyişmədən işləyir
// ----------------------------------------------------------------------------

test("Köhnə «5 Struktur bölmələri» faylı: xəbərdarlıqsız oxunur, yeni sahələr sətirdə yoxdur (mövcud dəyərlərə toxunulmur)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ehr-struct-"));
  try {
    const file = path.join(dir, "5 Struktur bölmələri.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("1-ci mərhələ struktur bölmələri").addRows([
      ["Kod", "Ad", "Fakultə (Bəli/Xeyr)", "Kafedra (Bəli/Xeyr)", "Bölmənin yaradılma tarixi", "Bölmənin bağlanma tarixi"],
      ["F1", "Energetika fakültəsi", "Bəli", "Xeyr", "01.09.2000", null],
    ]);
    for (const n of ["2-ci", "3-cü", "4-cü"])
      wb.addWorksheet(`${n} mərhələ struktur bölmələri`).addRow(["Kod", "Ad", "Tabe olduğu struktur bölmənin kodu", "Fakultə (Bəli/Xeyr)", "Kafedra (Bəli/Xeyr)", "Bölmənin yaradılma tarixi", "Bölmənin bağlanma tarixi"]);
    wb.getWorksheet("2-ci mərhələ struktur bölmələri")!.addRow(["F1-01", "Elektroenergetika kafedrası", "F1", "Xeyr", "Bəli", "01.09.2001", null]);
    await wb.xlsx.writeFile(file);

    const rows: { sheet: string; data: Record<string, string> }[] = [];
    const { issues } = await streamWorkbook(file, "departments", async (c) => {
      rows.push(...c.rows.map((r) => ({ sheet: c.sheetKey, data: r.data })));
    });
    assert.deepEqual(issues, [], "köhnə faylda xəbərdarlıq yoxdur (5-ci, 6-cı vərəq könüllüdür)");
    assert.equal(rows.length, 2);
    for (const r of rows) for (const k of ["kind", "sortOrder", "isExternal", "isGroup", "headPositionTitle"]) assert.equal(Object.hasOwn(r.data, k), false);
    const parsed = getSheet("departments2").schema.parse(rows[1]!.data) as { kind?: string; isExternal?: boolean; isChair: boolean };
    assert.equal(parsed.kind, undefined);
    assert.equal(parsed.isExternal, undefined);
    assert.equal(parsed.isChair, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Yeni sütunlar: növ (ad və ya kod), sıra, ayrıca hüquqi şəxs, qrup, rəhbərin vəzifəsi; növ–bayraq ziddiyyəti xətadır", () => {
  const ctx = loadContextFromScratch();
  const r = validateRow(
    getSheet("departments1"),
    { code: "P1", name: "Tədris məsələləri üzrə prorektor", createdOn: "28.09.2026", kind: "Kurator bloku", sortOrder: "3", isExternal: "Xeyr", isGroup: "", headPositionTitle: "Prorektor (tədris üzrə)" },
    ctx,
    2,
  );
  const p = r.parsed as { kind: string; sortOrder: number; isExternal: boolean; isGroup: boolean; headPositionTitle: string };
  assert.equal(p.kind, "KURATOR_BLOKU");
  assert.equal(p.sortOrder, 3);
  assert.equal(p.isExternal, false);
  assert.equal(p.isGroup, false, "sütun var, xana boş — false");
  assert.equal(p.headPositionTitle, "Prorektor (tədris üzrə)");
  const conflict = validateRow(getSheet("departments1"), { code: "F9", name: "X", createdOn: "01.01.2020", kind: "SOBE", isFaculty: "Bəli" }, ctx, 3);
  assert.ok(conflict.issues.some((i) => i.field === "kind" && i.severity === "error"));
  const unknown = validateRow(getSheet("departments1"), { code: "F8", name: "X", createdOn: "01.01.2020", kind: "Planet" }, ctx, 4);
  assert.equal(unknown.parsed, null);
});

// ----------------------------------------------------------------------------
//  Tarixə görə struktur və planlaşdırılmış dəyişikliklər
// ----------------------------------------------------------------------------

const current: DeptSnapshot[] = [
  { id: "R", name: "Rektorluq", parentId: null, createdOn: D("2000-01-01"), closedOn: null, level: 1 },
  { id: "P1", name: "Tədris prorektoru", parentId: null, createdOn: D("2000-01-01"), closedOn: null, level: 1 },
  { id: "HR", name: "İnsan resursları departamenti", parentId: "R", createdOn: D("2000-01-01"), closedOn: null, level: 2 },
  { id: "OLD", name: "Köhnə şöbə", parentId: "R", createdOn: D("2000-01-01"), closedOn: D("2026-06-01"), level: 2 },
  { id: "NEW", name: "Yeni mərkəz", parentId: "P1", createdOn: D("2026-06-01"), closedOn: null, level: 2 },
];
const rename: ChangeRecord = {
  departmentId: "HR",
  kind: "RENAME",
  effectiveDate: D("2026-05-01"),
  before: { name: "Kadrlar şöbəsi" },
  after: { name: "İnsan resursları departamenti" },
  appliedAt: D("2026-05-01"),
  cancelledAt: null,
  createdAt: D("2026-04-20"),
};
const move: ChangeRecord = { ...rename, kind: "MOVE", effectiveDate: D("2026-07-01"), before: { parentId: "P1" }, after: { parentId: "R" }, createdAt: D("2026-06-20") };

test("Tarixə görə struktur: ad dəyişikliyindən əvvəlki gün köhnə adı, sonrakı gün yeni adı göstərir", () => {
  const before = structureAsOf(current, [rename, move], D("2026-04-30"));
  assert.equal(before.find((d) => d.id === "HR")!.name, "Kadrlar şöbəsi");
  assert.equal(before.find((d) => d.id === "HR")!.parentId, "P1", "köçürmədən əvvəlki valideyn");
  assert.ok(before.some((d) => d.id === "OLD"), "bağlanmadan əvvəl köhnə şöbə görünür");
  assert.ok(!before.some((d) => d.id === "NEW"), "yaradılmadan əvvəl yeni mərkəz yoxdur");
  const after = structureAsOf(current, [rename, move], D("2026-08-01"));
  assert.equal(after.find((d) => d.id === "HR")!.name, "İnsan resursları departamenti");
  assert.equal(after.find((d) => d.id === "HR")!.parentId, "R");
  assert.ok(!after.some((d) => d.id === "OLD"));
  assert.equal(after.find((d) => d.id === "NEW")!.level, 2);
  // Cari massiv dəyişdirilmir
  assert.equal(current.find((d) => d.id === "HR")!.name, "İnsan resursları departamenti");
});

test("Gələcək tarixli dəyişiklik cari ağacı dəyişmir; tarix çatanda tətbiq olunur və gələcək tarixə baxışda görünür", () => {
  const today = D("2026-11-07");
  const planned: ChangeRecord = { departmentId: "HR", kind: "MOVE", effectiveDate: D("2027-01-01"), before: { parentId: "R" }, after: { parentId: "P1" }, appliedAt: null, cancelledAt: null, createdAt: today };
  const close: ChangeRecord = { ...planned, kind: "CLOSE", departmentId: "NEW", before: { closedOn: null }, after: { closedOn: "2027-01-01" } };
  const now = structureAsOf(current, [rename, planned, close], today);
  assert.equal(now.find((d) => d.id === "HR")!.parentId, "R", "bu gün — köhnə tabelik");
  assert.ok(now.some((d) => d.id === "NEW"));
  assert.deepEqual(dueChanges([planned, close], today), [], "vaxtı çatmayıb — tətbiq olunmur");
  assert.equal(dueChanges([planned, close], D("2027-01-01")).length, 2, "tarix çatanda tətbiq olunur");
  const future = structureAsOf(current, [rename, planned, close], D("2027-01-02"));
  assert.equal(future.find((d) => d.id === "HR")!.parentId, "P1");
  assert.equal(future.find((d) => d.id === "HR")!.level, 2);
  assert.ok(!future.some((d) => d.id === "NEW"), "planlaşdırılmış bağlanma");
  // Ləğv edilmiş planlaşdırma nəzərə alınmır
  const cancelled = structureAsOf(current, [{ ...planned, cancelledAt: today }], D("2027-02-01"));
  assert.equal(cancelled.find((d) => d.id === "HR")!.parentId, "R");
});

test("Bağlanma: aktiv müqavilə və açıq alt bölmə bloklayır, ştat və sənəd yalnız göstərilir", () => {
  assert.deepEqual(closeBlockers({ activeEmployments: 0, openChildren: 0, staffingUnits: 4, documents: 2, headUsers: 1 }), []);
  const b = closeBlockers({ activeEmployments: 3, openChildren: 1, staffingUnits: 0, documents: 0, headUsers: 0 });
  assert.equal(b.length, 2);
  assert.match(b[0]!, /3 aktiv müqavilə/);
  assert.match(b[1]!, /alt bölmə/);
});

// ----------------------------------------------------------------------------
//  Əsasnamə / vəzifə təlimatı: versiya və status qaydaları
// ----------------------------------------------------------------------------

test("Təsdiqlənmiş və qüvvədən düşmüş versiya dəyişdirilə bilmir; təsdiqi yalnız icazəli hesab edir", () => {
  assert.equal(isEditable("QARALAMA"), true);
  assert.equal(isEditable("HUQUQI_REYDE"), true);
  assert.throws(() => assertEditable("TESDIQLENIB"), RegulationError);
  assert.throws(() => assertEditable("QUVVEDEN_DUSUB"), /dəyişdirilə bilməz/);
  assert.match(transitionError("QARALAMA", "TESDIQLENIB", false)!, /icazə/);
  assert.equal(transitionError("QARALAMA", "TESDIQLENIB", true), null);
  assert.equal(transitionError("QARALAMA", "HUQUQI_REYDE", false), null);
  assert.ok(transitionError("TESDIQLENIB", "QARALAMA", true), "təsdiqlənmiş qaralamaya qayıtmır");
  assert.ok(transitionError("QUVVEDEN_DUSUB", "TESDIQLENIB", true));
});

test("Yeni versiya: nömrə artır, qüvvədə olan təsdiqlənmişin ən yenisidir, köhnəsi qüvvədən düşür", () => {
  const rows = [
    { id: "v1", version: 1, status: "QUVVEDEN_DUSUB" as const, effectiveFrom: D("2024-01-01") },
    { id: "v2", version: 2, status: "TESDIQLENIB" as const, effectiveFrom: D("2025-01-01") },
    { id: "v3", version: 3, status: "QARALAMA" as const, effectiveFrom: null },
  ];
  assert.equal(nextVersion(rows), 4);
  assert.equal(inForce(rows)!.id, "v2");
  assert.equal(openDraft(rows)!.id, "v3");
  assert.deepEqual(supersede(rows, "v3", D("2026-11-07")), [{ id: "v2", effectiveTo: D("2026-11-06") }]);
  assert.equal(reviewState(D("2026-11-20"), D("2026-11-07")), "soon");
  assert.equal(reviewState(D("2026-11-01"), D("2026-11-07")), "overdue");
  assert.equal(reviewState(D("2027-06-01"), D("2026-11-07")), null);
});

test("Təlimat yeniləndi: təsirlənən əməkdaşlara yeni tanışlıq tapşırığı, köhnə tanışlıqlar toxunulmaz; bölməyə xüsusi təlimat üstündür", () => {
  const v1: JdLite = { id: "jd1", positionId: "MUH", departmentId: null, version: 1, status: "QUVVEDEN_DUSUB" };
  const v2: JdLite = { id: "jd2", positionId: "MUH", departmentId: null, version: 2, status: "TESDIQLENIB" };
  const special: JdLite = { id: "jdK", positionId: "MUH", departmentId: "KAF1", version: 1, status: "TESDIQLENIB" };
  const emps = [
    { id: "e1", positionId: "MUH", departmentId: "KAF2" },
    { id: "e2", positionId: "MUH", departmentId: "KAF1" }, // bölməyə xüsusi təlimatı var
    { id: "e3", positionId: "DOS", departmentId: "KAF2" }, // başqa vəzifə
    { id: "e4", positionId: "MUH", departmentId: "KAF3" }, // artıq tapşırığı var
  ];
  const oldAcks = new Map([["jd1", ["e1", "e4"]]]); // v1 üzrə tanışlıqlar
  const targets = ackTargets(v2, [v1, v2, special], emps, new Set(["e4"]));
  assert.deepEqual(targets, ["e1"]);
  assert.deepEqual(oldAcks.get("jd1"), ["e1", "e4"], "köhnə versiyanın tanışlıqları silinmir");
  assert.equal(applicableJobDescription(emps[1]!, [v2, special])!.id, "jdK");
  assert.equal(applicableJobDescription(emps[0]!, [v2, special])!.id, "jd2");
  assert.equal(applicableJobDescription(emps[2]!, [v2, special]), null);
  // Bölməyə xüsusi təlimat təsdiqlənəndə yalnız həmin bölmənin əməkdaşları
  assert.deepEqual(ackTargets(special, [v2, special], emps, new Set()), ["e2"]);
});
