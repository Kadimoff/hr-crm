import ExcelJS from "exceljs";
import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { ORG_NAME } from "@/lib/org";
import { getReport, readReportParams } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hesabatı ekrandakı parametrlərlə .xlsx kimi qaytarır */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await apiUser("reports");
  if (user instanceof Response) return user;
  const report = getReport((await params).key);
  if (!report) return Response.json({ error: "Hesabat tapılmadı" }, { status: 404 });
  const result = await report.run(await departmentScope(user), readReportParams(new URL(request.url).searchParams));

  const wb = new ExcelJS.Workbook();
  wb.creator = "ASOİU HR CRM";
  const ws = wb.addWorksheet(report.title.slice(0, 31));
  const n = result.columns.length;
  ws.addRow([`${ORG_NAME} — ${report.title}`]).font = { bold: true, size: 13 };
  ws.addRow([result.note ?? ""]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.mergeCells(1, 1, 1, n);
  ws.mergeCells(2, 1, 2, n);
  const header = ws.addRow(result.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    cell.border = { bottom: { style: "thin" } };
  });
  result.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? 12;
    if (c.type === "money") col.numFmt = '#,##0.00 "₼"';
  });
  for (const r of result.rows) ws.addRow(result.columns.map((c) => r[c.key] ?? null));
  if (result.totals) ws.addRow(result.columns.map((c) => result.totals![c.key] ?? null)).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 3 }];

  await audit({ user, action: "EXPORT", entity: "Report", entityId: report.key, summary: `Hesabat Excel-ə ixrac edildi: ${report.title} (${result.rows.length} sətir)` });
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="hesabat-${report.key}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
