/**
 * Backup arxivlərinin şifrələnməsi — server xaricinə (S3, başqa server) göndəriləcək nüsxə üçün.
 *
 * Format (.enc): "HRCRMENC1" (9 bayt) · IV (12 bayt) · AES-256-GCM şifrəmətn · auth tag (16 bayt, sonda).
 * Fayl axınla emal olunur (GB ölçülü backup yaddaşa yığılmır). Açar — BACKUP_ENCRYPTION_KEY: 32 bayt, 64 hex simvol
 * və ya base64 (məs. `openssl rand -hex 32`). Açar itərsə şifrəli nüsxələr bərpa oluna bilməz — ayrıca saxlayın.
 *
 * Şifrəsiz .zip / .json.gz backup-lar (serverdəki əsas nüsxələr) dəyişmir — bərpa yolu olduğu kimi qalır.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const ENC_MAGIC = Buffer.from("HRCRMENC1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = ENC_MAGIC.length + IV_LEN;

/** BACKUP_ENCRYPTION_KEY → 32 baytlıq açar; boşdursa null; yanlış formatdırsa xəta */
export function parseEncryptionKey(raw: string | undefined | null): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY 32 bayt olmalıdır: 64 hex simvol (openssl rand -hex 32) və ya base64");
  return key;
}

/** Faylın əvvəlində şifrəli backup imzası varmı */
export async function isEncryptedBackup(path: string): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(ENC_MAGIC.length);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return bytesRead === buf.length && buf.equals(ENC_MAGIC);
  } finally {
    await fh.close();
  }
}

/** src → dst (.enc). Yarımçıq dst qalmasın deyə xətada silinir */
export async function encryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(dst, { mode: 0o600 });
  try {
    out.write(Buffer.concat([ENC_MAGIC, iv]));
    // Şifrəmətndən sonra auth tag yazılır — cipher.final()-dan sonra məlum olur
    const appendTag = new Transform({
      transform(chunk, _enc, cb) {
        cb(null, chunk);
      },
      flush(cb) {
        cb(null, cipher.getAuthTag());
      },
    });
    await pipeline(createReadStream(src), cipher, appendTag, out);
  } catch (e) {
    out.destroy();
    await rm(dst, { force: true });
    throw e;
  }
}

/** .enc → dst. Açar səhvdirsə və ya fayl dəyişdirilibsə (auth tag) xəta atılır və dst silinir */
export async function decryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const { size } = await stat(src);
  if (size < HEADER_LEN + TAG_LEN) throw new Error("Şifrəli backup faylı zədələnib (çox qısadır)");
  const fh = await open(src, "r");
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    await fh.read(header, 0, HEADER_LEN, 0);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) throw new Error("Fayl şifrəli backup deyil");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(ENC_MAGIC.length));
  decipher.setAuthTag(tag);
  try {
    // Bayt aralığı daxildir (inclusive): şifrəmətn = başlıqdan sonra, tag-dan əvvəl
    const body = size - TAG_LEN > HEADER_LEN ? createReadStream(src, { start: HEADER_LEN, end: size - TAG_LEN - 1 }) : Readable.from([]);
    await pipeline(body, decipher, createWriteStream(dst, { mode: 0o600 }));
  } catch {
    await rm(dst, { force: true });
    throw new Error("Şifrəli backup açılmadı: açar yanlışdır və ya fayl zədələnib");
  }
}
