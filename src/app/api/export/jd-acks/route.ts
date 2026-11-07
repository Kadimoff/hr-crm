import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getAcks } from "@/lib/positions-catalog";
import { xlsxResponse } from "@/lib/xlsx-response";

export const runtime = "nodejs";

/** Vəzifə təlimatı ilə tanış olmayanların Excel siyahısı (tanışlıq vərəqəsini imzalatmaq üçün) */
export async function GET() {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const rows = await getAcks({ pending: true, scope: await departmentScope(user) });
  await audit({ user, action: "EXPORT", entity: "JobDescriptionAck", summary: `Vəzifə təlimatı ilə tanış olmayanlar Excel-ə ixrac edildi: ${rows.length} tapşırıq` });
  return xlsxResponse(
    "tanis-olmayanlar.xlsx",
    "Tanış olmayanlar",
    [
      { header: "Əməkdaşın kodu", width: 14, value: (r) => r.code },
      { header: "Soyadı, adı, ata adı", width: 34, value: (r) => r.fullName },
      { header: "Struktur bölmə", width: 32, value: (r) => r.department },
      { header: "Vəzifə", width: 28, value: (r) => r.position },
      { header: "Vəzifə təlimatı", width: 40, value: (r) => r.jdTitle },
      { header: "Versiya", width: 8, value: (r) => r.jdVersion },
      { header: "Səbəb", width: 22, value: (r) => r.reason },
      { header: "Tapşırıq tarixi", width: 14, value: (r) => r.assignedAt, date: true },
      { header: "Tanışlıq tarixi (imza)", width: 18, value: () => null },
      { header: "İmza", width: 16, value: () => null },
    ],
    rows,
  );
}
