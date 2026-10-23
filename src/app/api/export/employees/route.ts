import ExcelJS from "exceljs";
import { z } from "zod";
import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getEmployeeRows, type EmployeeRow } from "@/lib/queries";

export const runtime = "nodejs";

const STATUS_LABEL = { ACTIVE: "Aktiv", ON_LEAVE: "Məzuniyyətdə", TERMINATED: "Azad olunub" } as const;

const COLUMNS: Record<string, { header: string; width: number; value: (r: EmployeeRow) => string | number | Date | null }> = {
  fullName: { header: "Soyadı, adı, ata adı", width: 34, value: (r) => r.fullName },
  code: { header: "Əməkdaş kodu", width: 14, value: (r) => r.code },
  position: { header: "Vəzifə", width: 30, value: (r) => r.position },
  department: { header: "Struktur bölmə", width: 30, value: (r) => r.department },
  staffCategory: { header: "Heyət", width: 18, value: (r) => r.staffCategory },
  status: { header: "Status", width: 14, value: (r) => (r.status ? STATUS_LABEL[r.status] : null) },
  hireDate: { header: "İşə qəbul", width: 12, value: (r) => (r.hireDate ? new Date(r.hireDate) : null) },
  baseSalary: { header: "Oklad (AZN)", width: 12, value: (r) => r.baseSalary },
  degree: { header: "Elmi dərəcə", width: 18, value: (r) => r.degree },
  title: { header: "Elmi ad", width: 12, value: (r) => r.title },
  gender: { header: "Cins", width: 8, value: (r) => (r.gender === "MALE" ? "Kişi" : "Qadın") },
  birthDate: { header: "Doğum tarixi", width: 12, value: (r) => new Date(r.birthDate) },
  fin: { header: "FİN", width: 10, value: (r) => r.fin },
  phone: { header: "Telefon", width: 16, value: (r) => r.phone },
  email: { header: "E-poçt", width: 26, value: (r) => r.email },
  contracts: { header: "Müqavilə sayı", width: 10, value: (r) => r.contracts },
  createdBy: { header: "Qeydiyyata alan", width: 16, value: (r) => r.createdBy },
};

const bodySchema = z.object({ ids: z.array(z.string()).max(100_000), cols: z.array(z.string()).max(50) });

/** Cədvəldə görünən sətir və sütunları (filtr + sıralama qorunur) Excel-ə ixrac edir */
export async function POST(request: Request) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const { ids, cols } = bodySchema.parse(await request.json());
  // Şöbə rəhbəri yalnız öz bölməsinin əməkdaşlarını ixrac edə bilər
  const all = await getEmployeeRows(await departmentScope(user));
  const byId = new Map(all.map((r) => [r.id, r]));
  const rows = ids.map((id) => byId.get(id)).filter((r): r is EmployeeRow => !!r);
  const selected = ["fullName", "code", ...cols.filter((c) => c !== "fullName")].filter((c) => c in COLUMNS);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Əməkdaşlar");
  ws.columns = selected.map((c) => ({ header: COLUMNS[c]!.header, key: c, width: COLUMNS[c]!.width, style: c.endsWith("Date") ? { numFmt: "dd.mm.yyyy" } : undefined }));
  for (const r of rows) ws.addRow(Object.fromEntries(selected.map((c) => [c, COLUMNS[c]!.value(r)])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: selected.length } };

  const buffer = await wb.xlsx.writeBuffer();
  await audit({ user, action: "EXPORT", entity: "Person", summary: `Əməkdaşlar Excel-ə ixrac edildi: ${rows.length} sətir, ${selected.length} sütun` });
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="emekdaslar.xlsx"',
    },
  });
}
