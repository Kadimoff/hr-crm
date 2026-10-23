import ExcelJS from "exceljs";
import { apiUser } from "@/lib/auth/session";
import { getSheet, TEMPLATES } from "@/lib/validation/templates";
import type { TemplateKey } from "@/lib/validation/types";

export const runtime = "nodejs";

/** Başlıqları şablon tərifindən götürülmüş boş .xlsx faylı */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const { key } = await params;
  if (!(key in TEMPLATES)) return new Response("Şablon tapılmadı", { status: 404 });
  const template = TEMPLATES[key as TemplateKey];

  const wb = new ExcelJS.Workbook();
  wb.creator = "ASOİU HR CRM";
  for (const sheetKey of template.sheets) {
    const def = getSheet(sheetKey);
    const ws = wb.addWorksheet(def.sheetNames?.[0] ?? def.title);
    const grouped = def.columns.some((c) => c.group);
    const headerRows = grouped ? 2 : 1;

    // Real şablondakı kimi: qrup sütunları üst sətirdə birləşdirilir, qalanları şaquli birləşdirilir
    def.columns.forEach((c, i) => {
      const col = i + 1;
      ws.getColumn(col).width = Math.max(14, Math.min(40, c.header.length + 4));
      if (!grouped) {
        ws.getCell(1, col).value = c.header;
        return;
      }
      ws.getCell(1, col).value = c.group ?? c.header;
      ws.getCell(2, col).value = c.group ? c.header : null;
    });
    if (grouped) {
      let i = 0;
      while (i < def.columns.length) {
        const group = def.columns[i]!.group;
        let j = i;
        while (group && j + 1 < def.columns.length && def.columns[j + 1]!.group === group) j++;
        if (group) ws.mergeCells(1, i + 1, 1, j + 1);
        else ws.mergeCells(1, i + 1, 2, i + 1);
        i = j + 1;
      }
    }
    for (let r = 1; r <= headerRows; r++) {
      const row = ws.getRow(r);
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      def.columns.forEach((_, i) => {
        row.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      });
    }
    def.columns.forEach((c, i) => {
      if (c.required) ws.getCell(c.group ? headerRows : 1, i + 1).note = "Məcburi sahə";
    });
    ws.views = [{ state: "frozen", ySplit: headerRows }];
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.fileName)}`,
    },
  });
}
