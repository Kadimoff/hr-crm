import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { streamWorkbook } from "../src/lib/etl/parser";

/** Real "1 Kadr Cədvəlləri.xlsx" kimi iki sətirli, birləşdirilmiş başlıqlı vərəq */
test("Fiziki şəxslər: iki sətirli birləşdirilmiş başlıq düzgün tanınır", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ehr-parser-"));
  try {
    const file = path.join(dir, "1 Kadr Cədvəlləri.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fiziki şəxslər");
    ws.getRow(1).values = ["Əməkdaşın kodu", "Soyadı", "Adı", "Cins (K/Q)", "Doğum tarixi", "Şəxsiyyət vəsiqəsi", null, null, "Əmək stajı", null, null, "Elmi stajı", null, null];
    ws.getRow(2).values = [null, null, null, null, null, "Sənədin növü", "Nömrə", "FİN kod", "İllər", "Aylar", "Günlər", "İllər", "Aylar", "Günlər"];
    for (const range of ["A1:A2", "B1:B2", "C1:C2", "D1:D2", "E1:E2", "F1:H1", "I1:K1", "L1:N1"]) ws.mergeCells(range);
    ws.addRow(["E001", "Həsənov", "Rauf", "K", "12.03.1965", "Şəxsiyyət vəsiqəsi", "1000001", "1AB2C3D", 10, 2, 5, 3, 0, 0]);
    // Boş "Vəzifələr" vərəqi də olsun — yalnız başlıq
    wb.addWorksheet("Vəzifələr").addRow(["Vəzifənin kodu", "Vəzifənin adı"]);
    await wb.xlsx.writeFile(file);

    const rows: Record<string, string>[] = [];
    const { issues, sheets } = await streamWorkbook(file, "kadr", async (chunk) => {
      if (chunk.sheetKey === "persons") rows.push(...chunk.rows.map((r) => r.data));
    });
    assert.ok(sheets.some((s) => s.sheetKey === "persons" && s.rows === 1));
    assert.equal(rows[0]?.code, "E001");
    assert.equal(rows[0]?.fin, "1AB2C3D");
    assert.equal(rows[0]?.idDocNumber, "1000001");
    assert.equal(rows[0]?.laborSeniorityYears, "10");
    assert.equal(rows[0]?.laborSeniorityDays, "5");
    assert.equal(rows[0]?.scientificSeniorityYears, "3");
    // Vəzifələr vərəqində məcburi sütunlar çatışmır → struktur xətası
    assert.ok(issues.some((i) => i.sheet === "Vəzifələr" && i.severity === "error"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Köhnə şablonlardakı "UNEC" başlıqları yeni "ASOİU" sütunlarına uyğunlaşır */
test("Köhnə UNEC başlıqları alias kimi tanınır", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ehr-parser-"));
  try {
    const file = path.join(dir, "1 Kadr Cədvəlləri.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fiziki şəxslər");
    ws.getRow(1).values = ["Əməkdaşın kodu", "Soyadı", "Adı", "Cins (K/Q)", "Doğum tarixi", "Şəxsiyyət vəsiqəsi", null, null, "UNEC-də stajı", null, null];
    ws.getRow(2).values = [null, null, null, null, null, "Sənədin növü", "Nömrə", "FİN kod", "İllər", "Aylar", "Günlər"];
    for (const range of ["A1:A2", "B1:B2", "C1:C2", "D1:D2", "E1:E2", "F1:H1", "I1:K1"]) ws.mergeCells(range);
    ws.addRow(["E001", "Həsənov", "Rauf", "K", "12.03.1965", "Şəxsiyyət vəsiqəsi", "1000001", "1AB2C3D", 7, 1, 2]);
    wb.addWorksheet("Əmək fəaliyyəti").addRow(["Əməkdaşın kodu", "Əvvəlki iş yerinin adı", "Əvvəlki iş yerində vəzifəsi", "UNEC-də staj (bəli/xeyr)", "İşə qəbul tarixi"]);
    wb.getWorksheet("Əmək fəaliyyəti")!.addRow(["E001", "AMEA", "Müəllim", "bəli", "01.09.2000"]);
    await wb.xlsx.writeFile(file);

    const persons: Record<string, string>[] = [];
    const work: Record<string, string>[] = [];
    await streamWorkbook(file, "kadr", async (chunk) => {
      if (chunk.sheetKey === "persons") persons.push(...chunk.rows.map((r) => r.data));
      if (chunk.sheetKey === "workHistory") work.push(...chunk.rows.map((r) => r.data));
    });
    assert.equal(persons[0]?.unecSeniorityYears, "7");
    assert.equal(persons[0]?.unecSeniorityDays, "2");
    assert.equal(work[0]?.countsUnec, "bəli");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
