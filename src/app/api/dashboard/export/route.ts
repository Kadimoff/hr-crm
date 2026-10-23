import ExcelJS from "exceljs";
import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getDashboardDataset } from "@/lib/dashboard/data";
import { applyFilters, FILTER_KEYS, FILTER_LABELS, parseFilters } from "@/lib/dashboard/filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** İdarə panelindəki filtrlənmiş əməkdaş cədvəli → .xlsx (filtrlər URL parametrlərindən, səhifədəki ilə eyni) */
export async function GET(request: Request) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const filters = parseFilters(new URL(request.url).searchParams);
  const data = await getDashboardDataset(await departmentScope(user));
  const rows = applyFilters(data.rows, filters).sort((a, b) => a.fullName.localeCompare(b.fullName, "az"));
  const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? id;
  const summary = FILTER_KEYS.filter((k) => filters[k])
    .map((k) => `${FILTER_LABELS[k]}: ${k === "department" ? deptName(filters[k]!) : filters[k]}`)
    .join(" · ");

  const wb = new ExcelJS.Workbook();
  wb.creator = "ASOİU HR CRM";
  const ws = wb.addWorksheet("Əməkdaşlar");
  ws.addRow([summary ? `Filtrlər — ${summary}` : "Filtr yoxdur — bütün aktiv müqavilələr"]).font = { italic: true };
  ws.mergeCells(1, 1, 1, 8);
  const header = ws.addRow(["Kod", "Ad, soyad", "Struktur", "Vəzifə", "Kateqoriya", "Cins", "İşə qəbul", "Ştat vahidi"]);
  header.font = { bold: true };
  [10, 34, 30, 28, 18, 8, 12, 11].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(7).numFmt = "dd.mm.yyyy";
  for (const r of rows) {
    ws.addRow([r.code, r.fullName, r.deptPath[r.deptPath.length - 1]?.name ?? "", r.position, r.category, r.gender, new Date(r.hireDate), r.unitShare]);
  }
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 8 } };

  await audit({ user, action: "EXPORT", entity: "Report", entityId: "dashboard", summary: `İdarə paneli cədvəli Excel-ə ixrac edildi: ${rows.length} sətir${summary ? ` (${summary})` : ""}` });
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="idare-paneli-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
