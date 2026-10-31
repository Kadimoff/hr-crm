import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { can } from "@/lib/auth/roles";
import { canAccessPerson } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { DocumentExtension } from "@/lib/document-types";

/**
 * Şəxsi iş faylları: DOCUMENTS_DIR/<personId>/<sənəd id>.<uzantı>.
 * Bazada nisbi yol saxlanılır (<personId>/<id>.<uzantı>) — backup başqa kompüterdə bərpa olunanda da işləsin.
 */
export const DOCUMENTS_DIR = path.resolve(process.env.DOCUMENTS_DIR ?? "./storage/documents");

const absolute = (storagePath: string) => path.join(DOCUMENTS_DIR, storagePath);

/** Faylın əvvəlindəki imza — uzantısı dəyişdirilmiş başqa fayl (məs. HTML) qəbul olunmasın */
const SIGNATURES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  jpg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF
  tif: [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
  ],
  zip: [[0x50, 0x4b, 0x03, 0x04]], // docx, xlsx
  ole: [[0xd0, 0xcf, 0x11, 0xe0]], // doc, xls
};
const SIGNATURE_OF: Record<DocumentExtension, string> = { pdf: "pdf", jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", tif: "tif", tiff: "tif", docx: "zip", xlsx: "zip", doc: "ole", xls: "ole" };

export function matchesSignature(ext: DocumentExtension, buf: Buffer): boolean {
  return SIGNATURES[SIGNATURE_OF[ext]]!.some((sig) => sig.every((b, i) => buf[i] === b));
}

/** Faylı yazır və bazada saxlanılacaq nisbi yolu qaytarır */
export async function saveDocumentFile(personId: string, id: string, ext: DocumentExtension, buf: Buffer): Promise<string> {
  const storagePath = `${personId}/${id}.${ext}`;
  await mkdir(path.join(DOCUMENTS_DIR, personId), { recursive: true });
  await writeFile(absolute(storagePath), buf);
  return storagePath;
}

export const readDocumentFile = (storagePath: string) => readFile(absolute(storagePath)).catch(() => null);

export const removeDocumentFile = (storagePath: string) => unlink(absolute(storagePath)).catch(() => undefined);

/** Sənədə baxmaq hüququ: dosyeyə baxa bilən hər kəs; arxivdəki əməkdaşın sənədləri — yalnız redaktə hüququ olanlara */
export async function findAccessibleDocument(user: CurrentUser, id: string) {
  const doc = await prisma.personDocument.findUnique({ where: { id }, include: { person: { select: { fullName: true, deletedAt: true } } } });
  if (!doc) return null;
  if (doc.person.deletedAt ? !can(user.role, "employees.edit") : !(await canAccessPerson(user, doc.personId))) return null;
  return doc;
}

/** Content-Disposition: Azərbaycan hərfləri üçün filename* */
export function contentDisposition(type: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// ----------------------------------------------------------------------------
//  Word / Excel → HTML (brauzerdə baxış üçün; sandbox iframe-də göstərilir)
// ----------------------------------------------------------------------------

const MAX_SHEETS = 10;
const MAX_ROWS = 1000;
const MAX_COLS = 60;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (title: string, body: string) => `<!doctype html>
<html lang="az"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; background: #fff; margin: 0; padding: 32px; }
  .doc { max-width: 820px; margin: 0 auto; }
  .doc img { max-width: 100%; height: auto; }
  .doc table { border-collapse: collapse; margin: 12px 0; }
  .doc td, .doc th { border: 1px solid #cbd5e1; padding: 4px 8px; vertical-align: top; }
  h2.sheet { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #475569; margin: 28px 0 8px; }
  h2.sheet:first-child { margin-top: 0; }
  .grid { border-collapse: collapse; font-size: 12px; }
  .grid td, .grid th { border: 1px solid #e2e8f0; padding: 3px 8px; white-space: nowrap; }
  .grid th { background: #f1f5f9; color: #64748b; font-weight: 500; position: sticky; top: 0; }
  .grid td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .note { color: #64748b; font-size: 12px; margin: 6px 0 0; }
</style></head><body>${body}</body></html>`;

async function excelToHtml(buf: Buffer, title: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.worksheets.slice(0, MAX_SHEETS).forEach((ws) => {
    const rows = Math.min(ws.actualRowCount ? ws.rowCount : 0, MAX_ROWS);
    const cols = Math.min(ws.columnCount, MAX_COLS);
    parts.push(`<h2 class="sheet">${escapeHtml(ws.name)}</h2>`);
    if (!rows || !cols) {
      parts.push(`<p class="note">Vərəq boşdur</p>`);
      return;
    }
    const head = Array.from({ length: cols }, (_, c) => `<th>${escapeHtml(ws.getColumn(c + 1).letter)}</th>`).join("");
    const body: string[] = [];
    for (let r = 1; r <= rows; r++) {
      const row = ws.getRow(r);
      const cells = Array.from({ length: cols }, (_, c) => {
        const cell = row.getCell(c + 1);
        const num = typeof cell.value === "number";
        return `<td${num ? ' class="n"' : ""}>${escapeHtml(cell.text ?? "")}</td>`;
      });
      body.push(`<tr><th>${r}</th>${cells.join("")}</tr>`);
    }
    parts.push(`<table class="grid"><thead><tr><th></th>${head}</tr></thead><tbody>${body.join("")}</tbody></table>`);
    if (ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLS) parts.push(`<p class="note">Vərəq böyükdür — ilk ${MAX_ROWS} sətir və ${MAX_COLS} sütun göstərilir. Tam baxış üçün faylı yükləyin.</p>`);
  });
  if (wb.worksheets.length > MAX_SHEETS) parts.push(`<p class="note">İlk ${MAX_SHEETS} vərəq göstərilir.</p>`);
  return page(title, parts.join(""));
}

async function wordToHtml(buf: Buffer, title: string): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return page(title, `<div class="doc">${value || '<p class="note">Sənəddə mətn tapılmadı</p>'}</div>`);
}

export async function documentPreviewHtml(ext: string, buf: Buffer, title: string): Promise<string | null> {
  if (ext === "xlsx") return excelToHtml(buf, title);
  if (ext === "docx") return wordToHtml(buf, title);
  return null;
}
