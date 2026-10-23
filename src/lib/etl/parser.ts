import type { Readable } from "node:stream";
import ExcelJS from "exceljs";
import iterateStream from "exceljs/lib/utils/iterate-stream.js";
import { Open } from "unzipper";
import { formatAzDate, normalizeKey } from "../validation/primitives";
import { getSheet, TEMPLATES } from "../validation/templates";
import type { RawRow, SheetDef, SheetKey, TemplateKey } from "../validation/types";

const HEADER_SCAN_ROWS = 10;
const DAY_MS = 86_400_000;

export interface FileIssue {
  sheet: string;
  severity: "error" | "warning";
  message: string;
}

export interface ParsedSheetChunk {
  sheetKey: SheetKey;
  rows: { rowNumber: number; data: RawRow }[];
}

/** ExcelJS hüceyrə dəyərini mətnə çevirir; tarixlər DD.MM.YYYY olur */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Üzən nöqtə xətalarına qarşı ən yaxın günə yuvarlaqlaşdırma
    return formatAzDate(new Date(Math.round(value.getTime() / DAY_MS) * DAY_MS));
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Bəli" : "Xeyr";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as ExcelJS.CellFormulaValue).result;
      return result === undefined ? "" : cellText(result as ExcelJS.CellValue);
    }
    if ("hyperlink" in value) return String((value as ExcelJS.CellHyperlinkValue).text ?? "").trim();
    if ("error" in value) return "";
  }
  return String(value).trim();
}

function rowTexts(row: ExcelJS.Row): string[] {
  const values = row.values as ExcelJS.CellValue[]; // 1-indeksli
  const out: string[] = [];
  for (let i = 1; i < values.length; i++) out[i - 1] = cellText(values[i] ?? null);
  return out;
}

/**
 * Başlıq sətrini vərəq tərifinin sütunlarına uyğunlaşdırır; nəticə: sütun indeksi → sahə açarı.
 *
 * İki sətirli başlıqlar (məs. "Əmək stajı" → "İllər / Aylar / Günlər") üçün üst sətir `parents` kimi verilir.
 * Birləşdirilmiş xanalar axın rejimində yalnız ilk xanada dəyər saxladığından, üst sətir sağa doldurulur.
 */
function matchHeaders(def: SheetDef, headers: string[], parents: string[] | null): { mapping: Map<number, string>; score: number; missing: string[] } {
  const composite = new Map<string, string>(); // "qrup başlıq" → açar
  const plain = new Map<string, string>(); // "başlıq" → açar
  for (const col of def.columns) {
    if (col.group) composite.set(normalizeKey(`${col.group} ${col.header}`), col.key);
    else plain.set(normalizeKey(col.header), col.key);
    for (const g of col.groupAliases ?? []) composite.set(normalizeKey(`${g} ${col.header}`), col.key);
    for (const a of col.aliases ?? []) plain.set(normalizeKey(a), col.key);
  }

  // Üst sətri sağa doldur: boş xana + altında alt başlıq = birləşdirilmiş qrupun davamı
  const filledParents: string[] = [];
  if (parents) {
    let last = "";
    const width = Math.max(parents.length, headers.length);
    for (let i = 0; i < width; i++) {
      const p = parents[i] ?? "";
      if (p) last = p;
      filledParents[i] = p || (headers[i] ? last : "");
    }
  }

  const mapping = new Map<number, string>();
  const used = new Set<string>();
  const width = Math.max(headers.length, filledParents.length);
  for (let i = 0; i < width; i++) {
    const child = headers[i] ?? "";
    const parent = filledParents[i] ?? "";
    const candidates = [
      parent && child && normalizeKey(parent) !== normalizeKey(child) ? composite.get(normalizeKey(`${parent} ${child}`)) : undefined,
      child ? plain.get(normalizeKey(child)) : undefined,
      // Şaquli birləşdirilmiş xana (A1:A2) — alt xana boşdur
      !child && parent ? plain.get(normalizeKey(parent)) : undefined,
    ];
    const key = candidates.find((k) => k !== undefined && !used.has(k));
    if (key) {
      mapping.set(i, key);
      used.add(key);
    }
  }
  const missing = def.columns.filter((c) => c.required && !used.has(c.key)).map((c) => (c.group ? `${c.group} → ${c.header}` : c.header));
  return { mapping, score: used.size, missing };
}

interface ResolvedSheet {
  def: SheetDef;
  headerIndex: number;
  mapping: Map<number, string>;
  missing: string[];
  score: number;
}

/**
 * Vərəqi tərifə uyğunlaşdırır. Ad tanınmırsa başlıqlara görə ən uyğun tərif seçilir;
 * eyni sütunlu bir neçə tərif bərabər uyğun gəlirsə (məs. 4 məzuniyyət vərəqi) — qeyri-müəyyənlik qaytarılır.
 */
function resolveSheet(templateKey: TemplateKey, sheetName: string, rows: string[][]): ResolvedSheet | "ambiguous" | null {
  const defs = TEMPLATES[templateKey].sheets.map(getSheet);
  const byName = defs.find((d) => d.sheetNames?.some((n) => normalizeKey(n) === normalizeKey(sheetName)));
  const candidates = byName ? [byName] : defs;

  const bestPerDef: ResolvedSheet[] = [];
  for (const def of candidates) {
    let best: ResolvedSheet | null = null;
    for (let idx = 0; idx < rows.length; idx++) {
      const m = matchHeaders(def, rows[idx]!, idx > 0 ? rows[idx - 1]! : null);
      if (!best || m.score > best.score) best = { def, headerIndex: idx, ...m };
    }
    if (best) bestPerDef.push(best);
  }
  bestPerDef.sort((a, b) => b.score - a.score || a.missing.length - b.missing.length);
  const [first, second] = bestPerDef;
  if (!first || first.score === 0) return null;
  if (!byName && second && second.score === first.score && second.missing.length === first.missing.length) return "ambiguous";
  return first;
}

/** ExcelJS WorkbookReader-in daxili metodları (exceljs@4.4.0 — versiya package.json-da sabitlənib) */
interface ReaderInternals {
  model?: { sheets?: { name: string; rId: string; state?: string }[] };
  workbookRels?: { Id: string; Target: string }[];
  sharedStrings?: unknown[];
  _parseRels(entry: Readable): Promise<void>;
  _parseWorkbook(entry: Readable): Promise<void>;
  _parseSharedStrings(entry: Readable): AsyncIterable<unknown>;
  _parseStyles(entry: Readable): Promise<void>;
  _parseWorksheet(iterator: AsyncIterable<unknown>, sheetNo: string): Iterable<{ eventType: string; value: unknown }>;
}

/**
 * Vərəqləri ZIP-in mərkəzi kataloqu üzərindən birbaşa müraciətlə oxuyur.
 *
 * ExcelJS-in adi axın oxuyucusu ZIP-i ardıcıl oxuyur: (1) `sharedStrings.xml` / `workbook.xml` vərəqlərdən sonra
 * gəldikdə mətnlər və adlar itir, (2) istehlakçı yavaş olduqda (məs. hər hissə bazaya yazılarkən) növbəti vərəqlər
 * itirilir. Burada əvvəlcə metadata oxunur, sonra hər vərəq öz müstəqil axını ilə emal olunur — fayl yaddaşa yüklənmir.
 */
async function* worksheets(filePath: string, options: ConstructorParameters<typeof ExcelJS.stream.xlsx.WorkbookReader>[1]) {
  const dir = await Open.file(filePath);
  const entry = (p: string) => dir.files.find((f) => f.path === p || f.path === `/${p}`);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, options) as unknown as ReaderInternals;

  const rels = entry("xl/_rels/workbook.xml.rels");
  const workbook = entry("xl/workbook.xml");
  if (!rels || !workbook) throw new Error("Fayl Excel iş kitabı (.xlsx) deyil və ya zədələnib");
  await reader._parseRels(rels.stream());
  await reader._parseWorkbook(workbook.stream());
  const sst = entry("xl/sharedStrings.xml");
  if (sst) for await (const _ of reader._parseSharedStrings(sst.stream()));
  else reader.sharedStrings = [];
  const styles = entry("xl/styles.xml");
  if (styles) await reader._parseStyles(styles.stream());

  for (const sheet of reader.model?.sheets ?? []) {
    const target = reader.workbookRels?.find((r) => r.Id === sheet.rId)?.Target;
    const sheetNo = target ? /sheet(\d+)\.xml$/.exec(target)?.[1] : undefined;
    const file = sheetNo ? entry(`xl/worksheets/sheet${sheetNo}.xml`) : undefined;
    if (!sheetNo || !file) continue;
    for (const ev of reader._parseWorksheet(iterateStream(file.stream()), sheetNo)) {
      if (ev.eventType === "worksheet") yield ev.value as AsyncIterable<ExcelJS.Row> & { name: string };
    }
  }
}

/**
 * Faylı axınla oxuyur və hər vərəqin sətirlərini `chunkSize` ölçülü hissələrlə `onChunk`-a ötürür.
 * Bütün iş kitabı yaddaşa yüklənmir.
 */
export async function streamWorkbook(
  filePath: string,
  templateKey: TemplateKey,
  onChunk: (chunk: ParsedSheetChunk) => Promise<void>,
  chunkSize = 500,
): Promise<{ issues: FileIssue[]; sheets: { sheetKey: SheetKey; sheetName: string; rows: number }[] }> {
  const issues: FileIssue[] = [];
  const sheets: { sheetKey: SheetKey; sheetName: string; rows: number }[] = [];
  const seenKeys = new Set<SheetKey>();

  const sheetsIter = worksheets(filePath, {
    sharedStrings: "cache",
    styles: "cache", // tarix formatlı hüceyrələrin Date kimi oxunması üçün
    hyperlinks: "ignore",
    worksheets: "emit",
    entries: "ignore",
  });
  await readSheets(sheetsIter, templateKey, onChunk, chunkSize, issues, sheets, seenKeys);

  const missing = TEMPLATES[templateKey].sheets.filter((key) => !seenKeys.has(key)).map((key) => getSheet(key).title);
  if (missing.length > 0) {
    issues.push({ sheet: "Vərəqlər", severity: "warning", message: `Faylda olmayan vərəqlər ötürüldü: ${missing.join(", ")}` });
  }
  return { issues, sheets };
}

async function readSheets(
  reader: AsyncIterable<AsyncIterable<ExcelJS.Row> & { name: string }>,
  templateKey: TemplateKey,
  onChunk: (chunk: ParsedSheetChunk) => Promise<void>,
  chunkSize: number,
  issues: FileIssue[],
  sheets: { sheetKey: SheetKey; sheetName: string; rows: number }[],
  seenKeys: Set<SheetKey>,
): Promise<void> {
  for await (const ws of reader) {
    const sheetName = ws.name;
    const head: { number: number; texts: string[] }[] = [];
    const st: { resolved: ResolvedSheet | null; skip: boolean; count: number } = { resolved: null, skip: false, count: 0 };
    let buffer: { rowNumber: number; data: RawRow }[] = [];

    const flush = async () => {
      if (!st.resolved || buffer.length === 0) return;
      await onChunk({ sheetKey: st.resolved.def.key, rows: buffer });
      buffer = [];
    };

    const pushRow = async (number: number, texts: string[]) => {
      if (!st.resolved || texts.every((t) => !t)) return; // boş sətirlər ötürülür
      const data: RawRow = {};
      for (const [idx, key] of st.resolved.mapping) data[key] = texts[idx] ?? "";
      buffer.push({ rowNumber: number, data });
      st.count++;
      if (buffer.length >= chunkSize) await flush();
    };

    /** Başlığı təyin edir və ilk skan edilmiş sətirlərdən başlıqdan sonrakıları ötürür */
    const resolveHeader = async () => {
      const r = resolveSheet(templateKey, sheetName, head.map((h) => h.texts));
      if (r === "ambiguous") {
        issues.push({ sheet: sheetName, severity: "warning", message: `"${sheetName}" vərəqinin adı tanınmadı və sütunlarına görə birmənalı müəyyən edilmir — şablondakı vərəq adını saxlayın` });
        st.skip = true;
        return;
      }
      if (!r) {
        issues.push({ sheet: sheetName, severity: "warning", message: `"${sheetName}" vərəqi şablona uyğun gəlmir və ötürüldü` });
        st.skip = true;
        return;
      }
      if (seenKeys.has(r.def.key)) {
        issues.push({ sheet: sheetName, severity: "warning", message: `"${r.def.title}" vərəqi faylda təkrarlanır — ikinci nüsxə ötürüldü` });
        st.skip = true;
        return;
      }
      if (r.missing.length > 0) {
        issues.push({ sheet: sheetName, severity: "error", message: `Məcburi sütunlar tapılmadı: ${r.missing.join(", ")}` });
        st.skip = true;
        return;
      }
      seenKeys.add(r.def.key);
      st.resolved = r;
      const headerRowNo = head[r.headerIndex]!.number;
      for (const h of head) if (h.number > headerRowNo) await pushRow(h.number, h.texts);
    };

    for await (const row of ws) {
      if (st.skip) continue;
      if (st.resolved) {
        await pushRow(row.number, rowTexts(row));
        continue;
      }
      head.push({ number: row.number, texts: rowTexts(row) });
      if (head.length >= HEADER_SCAN_ROWS) await resolveHeader();
    }
    // Vərəqdə HEADER_SCAN_ROWS-dan az sətir olduqda
    if (!st.resolved && !st.skip && head.length > 0) await resolveHeader();

    await flush();
    if (st.resolved) sheets.push({ sheetKey: st.resolved.def.key, sheetName, rows: st.count });
  }
}
