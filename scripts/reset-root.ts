/**
 * Təcili ROOT şifrə bərpası (break-glass). Konteyner başlayanda docker-entrypoint.sh çağırır,
 * yalnız ROOT_RESET_HASH_B64 verildikdə işləyir.
 *
 *   ROOT_RESET_HASH_B64  — hashPassword() nəticəsinin base64-ü (açıq şifrə env-də saxlanılmır;
 *                          base64 — compose «$» interpolyasiyasından qorunmaq üçün)
 *   ROOT_RESET_USERNAME  — istəyə görə; verilməsə yeganə ROOT (və ya «root» adlı ROOT) seçilir
 *
 * Bir dəfə tətbiq olunur: eyni dəyər üçün audit jurnalında qeyd varsa, təkrar restartda heç nə etmir
 * (istifadəçi sonradan öz şifrəsini dəyişsə, üzərinə yazılmır). İşdən sonra env-i silmək tövsiyə olunur.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const b64 = process.env.ROOT_RESET_HASH_B64?.trim();
  if (!b64) return;
  const hash = Buffer.from(b64, "base64").toString("utf8").trim();
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(hash)) {
    console.error("[reset-root] ROOT_RESET_HASH_B64 düzgün scrypt hash deyil — heç nə edilmədi");
    return;
  }
  const marker = "reset-root:" + createHash("sha256").update(hash).digest("hex").slice(0, 16);
  const done = await prisma.auditLog.findFirst({ where: { action: "PASSWORD_RESET", entity: "User", summary: { contains: marker } } });
  if (done) {
    console.log("[reset-root] bu dəyər artıq tətbiq olunub — keçildi (env-i silə bilərsiniz)");
    return;
  }

  const wanted = process.env.ROOT_RESET_USERNAME?.trim().toLowerCase();
  const roots = await prisma.user.findMany({ where: { role: "ROOT" }, orderBy: { createdAt: "asc" } });
  const user = wanted
    ? roots.find((u) => u.username === wanted)
    : roots.length === 1 ? roots[0] : roots.find((u) => u.username === "root");
  if (!user) {
    console.error(`[reset-root] ROOT tapılmadı (ROOT sayı: ${roots.length}; adlar: ${roots.map((u) => u.username).join(", ") || "—"}) — ROOT_RESET_USERNAME verin`);
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, isActive: true, mustChangePassword: false, passwordChangedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.auditLog.create({
      data: { userId: user.id, username: user.username, action: "PASSWORD_RESET", entity: "User", entityId: user.id, summary: `ROOT şifrəsi server tərəfindən bərpa edildi (${marker})` },
    }),
  ]);
  console.log(`[reset-root] «${user.username}» ROOT şifrəsi yeniləndi, sessiyalar bağlandı`);
}

main()
  .catch((e) => console.error("[reset-root] xəta:", e instanceof Error ? e.message : e))
  .finally(() => prisma.$disconnect());
