import { hiddenSalaryPersonIds } from "@/lib/auth/salary-access";
import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getCompletenessRows } from "@/lib/data-completeness";
import { COMPLETENESS_FIELDS, COMPLETENESS_KEYS, type CompletenessField } from "@/lib/unknown-values";
import { xlsxResponse } from "@/lib/xlsx-response";

export const runtime = "nodejs";

/** «Məlumat tamlığı» siyahısının Excel ixracı — HR doldurmaq üçün (hər sahə ayrıca sütun: «doldurulmalı») */
export async function GET(request: Request) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const f = new URL(request.url).searchParams.get("field");
  const field = f && (COMPLETENESS_KEYS as string[]).includes(f) ? (f as CompletenessField) : null;
  const rows = (await getCompletenessRows(await departmentScope(user), await hiddenSalaryPersonIds(user))).filter((r) => !field || r.missing.includes(field));
  await audit({ user, action: "EXPORT", entity: "Person", summary: `Məlumat tamlığı siyahısı Excel-ə ixrac edildi: ${rows.length} əməkdaş${field ? ` (${COMPLETENESS_FIELDS[field]})` : ""}` });
  return xlsxResponse(
    "melumat-tamligi.xlsx",
    "Məlumat tamlığı",
    [
      { header: "Əməkdaşın kodu", width: 14, value: (r) => r.code },
      { header: "Soyadı, adı, ata adı", width: 34, value: (r) => r.fullName },
      { header: "Struktur bölmə", width: 32, value: (r) => r.department },
      { header: "Vəzifə", width: 28, value: (r) => r.position },
      ...COMPLETENESS_KEYS.map((k) => ({ header: COMPLETENESS_FIELDS[k], width: 16, value: (r: (typeof rows)[number]) => (r.missing.includes(k) ? "doldurulmalı" : "") })),
      { header: "Açılış stajı (il)", width: 14, value: (r) => r.openingSeniorityYears },
      { header: "Açılış stajının mənbəyi", width: 22, value: (r) => r.openingSenioritySource },
    ],
    rows,
    "Boş (məlum deyil) sahələr miqrasiyada uydurulmayıb. Doldurmaq üçün əməkdaşın dosyesində «Redaktə» və ya idxal şablonundan istifadə edin. Maaşı məxfi əməkdaşlar üçün oklad sahəsi göstərilmir.",
  );
}
