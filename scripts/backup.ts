/**
 * Serverdə avtomatik backup (bazanın + sənədlərin .zip-i, Verilənlər bazası səhifəsində görünür):
 *   npm run backup -- deploy    (yeni versiyadan əvvəl — avtomatik deploy skripti çağırır)
 *   npm run backup -- nightly   (gecə taymeri)
 * Hər növün ən yeni backup-ları saxlanılır, köhnələr silinir.
 */
import { createBackup, pruneBackups } from "../src/lib/admin/database";
import { prisma } from "../src/lib/db";

const reason = process.argv[2];
if (reason !== "deploy" && reason !== "nightly") {
  console.error("İstifadə: npm run backup -- deploy|nightly");
  process.exit(2);
}

try {
  const b = await createBackup("system", reason);
  const removed = await pruneBackups(reason);
  console.log(`backup: ${b.name} (${b.rows} sətir, ${b.documents} sənəd faylı, ${(b.size / 1024 / 1024).toFixed(1)} MB)${removed.length ? ` · silindi: ${removed.join(", ")}` : ""}`);
} finally {
  await prisma.$disconnect();
}
