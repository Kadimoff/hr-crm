import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { importBackup, uploadTempPath } from "@/lib/admin/database";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Başqa kompüterdən gətirilmiş backup (yalnız ROOT). Gövdə — faylın özü (multipart deyil), ad X-File-Name başlığında.
 * Fayl diskə axınla yazılır (yaddaşa yığılmır), sonra yoxlanılıb siyahıya əlavə olunur. Middleware bu marşrutu bufferləmir.
 */
export async function POST(request: Request) {
  const user = await apiUser("database.manage");
  if (user instanceof Response) return user;
  const fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  const ext = fileName.endsWith(".zip") ? "zip" : fileName.endsWith(".json.gz") ? "json.gz" : null;
  if (!ext) return Response.json({ error: "Yalnız .zip və ya .json.gz backup faylı qəbul olunur" }, { status: 400 });
  if (!request.body) return Response.json({ error: "Fayl boşdur" }, { status: 400 });

  const tmp = await uploadTempPath();
  try {
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream), createWriteStream(tmp));
    const b = await importBackup(tmp, ext);
    await audit({ user, action: "IMPORT", entity: "Backup", entityId: b.name, summary: `Backup faylı yükləndi: ${fileName} → ${b.name}` });
    return Response.json({ message: `Backup yükləndi: ${b.name} — indi "Bərpa et" ilə tətbiq edə bilərsiniz` });
  } catch (e) {
    await rm(tmp, { force: true });
    return Response.json({ error: e instanceof Error ? e.message : "Yükləmə alınmadı" }, { status: 400 });
  }
}
