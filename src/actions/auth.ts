"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const MAX_FAILED = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

/** Yalnız daxili yollara yönləndirmə (open redirect qarşısı) */
const safeNext = (v: FormDataEntryValue | null) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard");

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "İstifadəçi adı və şifrəni daxil edin" };

  const failed = await prisma.auditLog.count({
    where: { action: "LOGIN_FAILED", username, createdAt: { gte: new Date(Date.now() - LOCK_WINDOW_MS) } },
  });
  if (failed >= MAX_FAILED) return { error: "Çox sayda uğursuz cəhd — 15 dəqiqə sonra yenidən yoxlayın" };

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok || !user.isActive) {
    await audit({ user: null, username, action: "LOGIN_FAILED", entity: "Session", summary: user && !user.isActive ? "Deaktiv hesabla giriş cəhdi" : "Yanlış istifadəçi adı və ya şifrə" });
    return { error: "İstifadəçi adı və ya şifrə yanlışdır" };
  }

  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ user, action: "LOGIN", entity: "Session", entityId: user.id, summary: "Sistemə daxil oldu" });
  redirect(safeNext(form.get("next")));
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
