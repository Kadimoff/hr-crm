import ExcelJS from "exceljs";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { DEPARTMENT_KIND_LABELS } from "@/lib/org-structure";
import { getDepartmentRegistry } from "@/lib/structure-registry";
import { DEPARTMENT_SHEETS, getSheet, TEMPLATES } from "@/lib/validation/templates";
import { formatAzDate } from "@/lib/validation/primitives";

export const runtime = "nodejs";

/**
 * Cari struktur «5 Struktur bölmələri» idxal şablonu formatında (səviyyə üzrə vərəq, yeni sütunlar daxil) —
 * redaktə edib yenidən idxal etmək olar (kod üzrə upsert).
 */
export async function GET() {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const rows = await getDepartmentRegistry();
  const code = new Map(rows.map((r) => [r.id, r.code]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "ASOİU HR CRM";
  for (const key of DEPARTMENT_SHEETS) {
    const def = getSheet(key);
    const level = DEPARTMENT_SHEETS.indexOf(key) + 1;
    const list = rows.filter((r) => r.level === level);
    if (level > 4 && list.length === 0) continue;
    const ws = wb.addWorksheet(def.sheetNames?.[0] ?? def.title);
    ws.columns = def.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, Math.min(48, c.header.length + 4)) }));
    const yes = (b: boolean) => (b ? "Bəli" : "Xeyr");
    for (const r of list)
      ws.addRow({
        code: r.code,
        name: r.name,
        parentCode: r.parentId ? (code.get(r.parentId) ?? "") : "",
        isFaculty: yes(r.kind === "FAKULTE"),
        isChair: yes(r.kind === "KAFEDRA"),
        createdOn: formatAzDate(r.createdOn),
        closedOn: formatAzDate(r.closedOn),
        kind: r.kind ? DEPARTMENT_KIND_LABELS[r.kind] : "",
        sortOrder: r.sortOrder ?? "",
        isExternal: yes(r.isExternal),
        isGroup: yes(r.isGroup),
        headPositionTitle: r.headPositionTitle ?? "",
        campus: r.campus ?? "",
        budgetCenter: r.budgetCenter ?? "",
      });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const buffer = await wb.xlsx.writeBuffer();
  await audit({ user, action: "EXPORT", entity: "Department", summary: `Struktur Excel-ə ixrac edildi: ${rows.length} bölmə` });
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(TEMPLATES.departments.fileName)}`,
    },
  });
}
