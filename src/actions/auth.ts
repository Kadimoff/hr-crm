"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { CHANGE_PASSWORD_PATH, clientIp, createSession, currentSessionId, destroySession, getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Eyni IP-dən eyni istifadəçi adına uğursuz cəhdlər (başqası root-u öz IP-sindən kilidləyə bilməsin deyə — cüt üzrə) */
const MAX_FAILED_PER_USER_IP = 5;
/** Bir IP-dən istənilən istifadəçi adlarına uğursuz cəhdlər (ad seçmə hücumu) */
const MAX_FAILED_PER_IP = 20;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

/** Son 15 dəqiqədə bu IP-dən uğursuz cəhdlərə görə blok mesajı; blok yoxdursa null */
async function loginBlock(username: string, ip: string | null): Promise<string | null> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const [byIp, byPair] = await Promise.all([
    prisma.auditLog.count({ where: { action: "LOGIN_FAILED", ip, createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: "LOGIN_FAILED", ip, username, createdAt: { gte: since } } }),
  ]);
  if (byIp >= MAX_FAILED_PER_IP) return "Bu ünvandan çox sayda uğursuz cəhd edilib — 15 dəqiqə sonra yenidən yoxlayın";
  if (byPair >= MAX_FAILED_PER_USER_IP) return "Çox sayda uğursuz cəhd — 15 dəqiqə sonra yenidən yoxlayın";
  return null;
}

/** Yalnız daxili yollara yönləndirmə (open redirect qarşısı); "/\\host" brauzerdə "//host" kimi açılır — rədd edilir */
const safeNext = (v: FormDataEntryValue | null) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/dashboard");

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "İstifadəçi adı və şifrəni daxil edin" };

  // Kilid istifadəçi adına yox, «istifadəçi + IP» cütünə və IP-yə bağlıdır: başqa ünvandan edilən cəhdlər həqiqi sahibini kilidləmir
  const blocked = await loginBlock(username, await clientIp());
  if (blocked) return { error: blocked };

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok || !user.isActive) {
    await audit({ user: null, username, action: "LOGIN_FAILED", entity: "Session", summary: user && !user.isActive ? "Deaktiv hesabla giriş cəhdi" : "Yanlış istifadəçi adı və ya şifrə" });
    return { error: "İstifadəçi adı və ya şifrə yanlışdır" };
  }

  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ user, action: "LOGIN", entity: "Session", entityId: user.id, summary: "Sistemə daxil oldu" });
  // Root yaradıb / sıfırladığı şifrə ilə ilk giriş — əvvəlcə öz şifrəsini təyin etməlidir
  redirect(user.mustChangePassword ? CHANGE_PASSWORD_PATH : safeNext(form.get("next")));
}

export interface ChangePasswordState {
  ok?: boolean;
  /** Bağlanan digər sessiyaların sayı */
  closedSessions?: number;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * İstifadəçinin öz şifrəsini dəyişməsi (həm istifadəçi menyusundan, həm ilk girişdə məcburi).
 * Cari şifrə yoxlanılır; uğurlu dəyişiklikdən sonra bu sessiyadan başqa bütün sessiyalar bağlanır.
 */
export async function changePasswordAction(_prev: ChangePasswordState, form: FormData): Promise<ChangePasswordState> {
  // assertUser yox: məcburi dəyişmə rejimində də işləməlidir
  const user = await getCurrentUser();
  if (!user) return { error: "Sessiya bitib — yenidən daxil olun" };
  const current = String(form.get("current") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!current) fieldErrors.current = "Cari şifrəni daxil edin";
  const problem = passwordProblem(password);
  if (problem) fieldErrors.password = problem;
  else if (password === current) fieldErrors.password = "Yeni şifrə cari şifrədən fərqli olmalıdır";
  if (password !== confirm) fieldErrors.confirm = "Şifrələr uyğun gəlmir";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  // Cari şifrənin təxmin edilməsinə qarşı — girişlə eyni limit (uğursuz yoxlama LOGIN_FAILED kimi yazılır)
  const blocked = await loginBlock(user.username, await clientIp());
  if (blocked) return { error: blocked };
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    await audit({ user: null, username: user.username, action: "LOGIN_FAILED", entity: "Session", summary: "Şifrə dəyişmə: cari şifrə yanlışdır" });
    return { fieldErrors: { current: "Cari şifrə yanlışdır" } };
  }

  const keep = await currentSessionId();
  const passwordHash = await hashPassword(password);
  const closed = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    // Köhnə şifrə ilə açılmış digər sessiyalar (başqa brauzer / kompüter) bağlanır
    const { count } = await tx.session.deleteMany({ where: { userId: user.id, ...(keep ? { NOT: { id: keep } } : {}) } });
    await audit(
      {
        user,
        action: "PASSWORD_CHANGE",
        entity: "User",
        entityId: user.id,
        summary: `${user.mustChangePassword ? "İlk girişdə şifrə dəyişdirildi" : "Şifrə dəyişdirildi"}${count ? ` · ${count} digər sessiya bağlandı` : ""}`,
      },
      tx,
    );
    return count;
  });
  return { ok: true, closedSessions: closed };
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit({ user, action: "LOGOUT", entity: "Session", entityId: user.id, summary: "Sistemdən çıxdı" });
  redirect("/login");
}

const setupSchema = z
  .object({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "3–32 simvol: latın hərfləri, rəqəm, . _ -"),
    fullName: z.string().trim().min(3, "Ad, soyad daxil edin"),
    password: z.string(),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.password);
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
    if (v.password !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "Şifrələr uyğun gəlmir" });
  });

/** İlk işə salma: sistemdə heç bir istifadəçi yoxdursa, root hesabı yaradılır */
export async function setupRootAction(_prev: FormState, form: FormData): Promise<FormState> {
  if ((await prisma.user.count()) > 0) return { error: "Sistem artıq qurulub — daxil olun" };
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const { username, fullName, password } = parsed.data;

  const user = await prisma.user.create({ data: { username, fullName, role: "ROOT", passwordHash: await hashPassword(password) } });
  await audit({ user, action: "CREATE", entity: "User", entityId: user.id, summary: `İlkin root hesabı yaradıldı: ${username}` });
  await createSession(user.id);
  redirect("/dashboard");
}
