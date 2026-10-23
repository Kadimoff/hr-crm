import { readBackup } from "@/lib/admin/database";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Backup faylının yüklənməsi (yalnız ROOT) */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await apiUser("database.manage");
  if (user instanceof Response) return user;
  const { name } = await params;
  const buf = await readBackup(name);
  if (!buf) return Response.json({ error: "Backup faylı tapılmadı" }, { status: 404 });
  await audit({ user, action: "EXPORT", entity: "Backup", entityId: name, summary: `Backup faylı yükləndi: ${name}` });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
