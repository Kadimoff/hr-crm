import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getContractEnds, parseThresholds } from "@/lib/contract-ends";
import { xlsxResponse } from "@/lib/xlsx-response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const thresholds = parseThresholds(new URL(request.url).searchParams.get("d") ?? undefined);
  const rows = await getContractEnds(await departmentScope(user), thresholds);
  await audit({ user, action: "EXPORT", entity: "Person", summary: `Müqavilə müddətləri Excel-ə ixrac edildi: ${rows.length} müqavilə (${thresholds.join("/")} gün)` });
  return xlsxResponse(
    "muqavile-muddetleri.xlsx",
    "Müqavilə müddətləri",
    [
      { header: "Əməkdaşın kodu", width: 14, value: (r) => r.code },
      { header: "Soyadı, adı, ata adı", width: 34, value: (r) => r.fullName },
      { header: "Struktur bölmə", width: 32, value: (r) => r.department },
      { header: "Vəzifə", width: 28, value: (r) => r.position },
      { header: "Bitmə tarixi", width: 14, value: (r) => r.endDate, date: true },
      { header: "Qalan gün", width: 10, value: (r) => r.daysLeft },
      { header: "Pillə", width: 12, value: (r) => (r.bucket === "overdue" ? "keçib" : `≤ ${r.bucket} gün`) },
      { header: "Məsul", width: 24, value: (r) => r.owner },
      { header: "Qərar", width: 36, value: (r) => r.decision },
    ],
    rows,
  );
}
