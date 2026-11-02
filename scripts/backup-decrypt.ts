/**
 * Server xaricindəki şifrəli backup-ı (.zip.enc) adi .zip-ə çevirir:
 *   BACKUP_ENCRYPTION_KEY=… npm run backup:decrypt -- backup-20260101-034500000-nightly.zip.enc [çıxış.zip]
 * Alınan .zip «Verilənlər bazası → Fayldan yüklə» ilə yüklənib bərpa olunur. (Açar serverdə təyin edilibsə, .enc faylı
 * birbaşa da yükləmək olar — server özü açır.)
 */
import { decryptFile, parseEncryptionKey } from "../src/lib/backup-crypto";

const [src, out] = process.argv.slice(2);
if (!src) {
  console.error("İstifadə: BACKUP_ENCRYPTION_KEY=… npm run backup:decrypt -- <fayl.zip.enc> [çıxış.zip]");
  process.exit(2);
}
const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
if (!key) {
  console.error("BACKUP_ENCRYPTION_KEY təyin edilməyib");
  process.exit(2);
}
const dst = out ?? src.replace(/\.enc$/, "");
if (dst === src) {
  console.error("Çıxış faylının adını verin");
  process.exit(2);
}
await decryptFile(src, dst, key);
console.log(`açıldı: ${dst}`);
