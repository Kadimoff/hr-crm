import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { importBackup, uploadTempPath } from "@/lib/admin/database";
import { decryptFile, isEncryptedBackup, parseEncryptionKey } from "@/lib/backup-crypto";
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
  // Server xaricindəki şifrəli nüsxə (.zip.enc) — serverdəki BACKUP_ENCRYPTION_KEY ilə açılır
  const encrypted = fileName.endsWith(".enc");
  const inner = encrypted ? fileName.slice(0, -4) : fileName;
  const ext = inner.endsWith(".zip") ? "zip" : inner.endsWith(".json.gz") ? "json.gz" : null;
  if (!ext) return Response.json({ error: "Yalnız .zip, .json.gz və ya şifrəli .zip.enc backup faylı qəbul olunur" }, { status: 400 });
  if (!request.body) return Response.json({ error: "Fayl boşdur" }, { status: 400 });
  let key: Buffer | null = null;
  try {
    key = encrypted ? parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY) : null;
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Şifrələmə açarı yanlışdır" }, { status: 400 });
  }
  if (encrypted && !key) return Response.json({ error: "Şifrəli backup üçün serverdə BACKUP_ENCRYPTION_KEY təyin edilməyib — faylı əvvəlcə npm run backup:decrypt ilə açın" }, { status: 400 });

  const tmp = await uploadTempPath();
  const plain = `${tmp}.dec`;
  try {
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream), createWriteStream(tmp));
    let source = tmp;
    if (encrypted) {
      if (!(await isEncryptedBackup(tmp))) throw new Error("Fayl şifrəli backup deyil");
      await decryptFile(tmp, plain, key!);
      await rm(tmp, { force: true });
      source = plain;
    }
    const b = await importBackup(source, ext);
    await audit({ user, action: "IMPORT", entity: "Backup", entityId: b.name, summary: `Backup faylı yükləndi: ${fileName} → ${b.name}` });
    return Response.json({ message: `Backup yükləndi: ${b.name} — indi "Bərpa et" ilə tətbiq edə bilərsiniz` });
  } catch (e) {
    await rm(tmp, { force: true });
    await rm(plain, { force: true });
    return Response.json({ error: e instanceof Error ? e.message : "Yükləmə alınmadı" }, { status: 400 });
  }
}
