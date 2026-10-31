import { Readable } from "node:stream";
import { openBackupStream } from "@/lib/admin/database";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Backup faylının endirilməsi (yalnız ROOT) — axınla, fayl GB ölçülü ola bilər */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await apiUser("database.manage");
  if (user instanceof Response) return user;
  const { name } = await params;
  const file = await openBackupStream(name);
  if (!file) return Response.json({ error: "Backup faylı tapılmadı" }, { status: 404 });
  await audit({ user, action: "EXPORT", entity: "Backup", entityId: name, summary: `Backup faylı yükləndi: ${name}` });
  return new Response(Readable.toWeb(file.stream) as ReadableStream, {
    headers: {
      "Content-Type": name.endsWith(".zip") ? "application/zip" : "application/gzip",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
