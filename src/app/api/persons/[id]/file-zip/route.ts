import { salaryAccessFor } from "@/lib/auth/salary-access";
import { canAccessPerson } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { contentDisposition } from "@/lib/documents";
import { personalFileZip } from "@/lib/personal-file-export";
import { getDossier } from "@/lib/queries";

export const runtime = "nodejs";

/**
 * Şəxsi işin tam ZIP arxivi (TZ M05-01): yalnız redaktə hüququ olanlar (HR, root), bölmə məhdudiyyəti ilə;
 * maaş məxfiliyi — indeksdə oklad gizlədilir; audit jurnalına yazılır.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser("employees.edit");
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await canAccessPerson(user, id))) return Response.json({ error: "Əməkdaş tapılmadı" }, { status: 404 });
  const salary = await salaryAccessFor(user, id);
  const data = await getDossier(id, { hideSalary: !salary.visible });
  if (!data || data.person.deletedAt) return Response.json({ error: "Əməkdaş tapılmadı" }, { status: 404 });
  await audit({ user, action: "EXPORT", entity: "Person", entityId: id, summary: `Şəxsi iş ZIP arxivi yükləndi: ${data.person.fullName} (${data.person.code}) — ${data.person.documents.length} sənəd` });
  return new Response(await personalFileZip(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition("attachment", `sexsi-is-${data.person.code}.zip`),
      "Cache-Control": "no-store",
    },
  });
}
