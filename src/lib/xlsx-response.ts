import "server-only";
import ExcelJS from "exceljs";

export interface XlsxColumn<T> {
  header: string;
  width?: number;
  value: (r: T) => string | number | Date | null | undefined;
  date?: boolean;
}

/** Bir vərəqli Excel cavabı (başlıq qalın, dondurulmuş, avtofiltr) */
export async function xlsxResponse<T>(fileName: string, sheet: string, columns: XlsxColumn<T>[], rows: T[], note?: string): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  ws.columns = columns.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width ?? 18, style: c.date ? { numFmt: "dd.mm.yyyy" } : undefined }));
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c, i) => [`c${i}`, c.value(r) ?? null])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  if (note) {
    const n = wb.addWorksheet("Qeyd");
    n.getCell("A1").value = note;
    n.getColumn(1).width = 120;
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
