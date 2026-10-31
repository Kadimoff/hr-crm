import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { can, type Permission } from "./roles";

export const SESSION_COOKIE = "ehr_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface CurrentUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  /** Şəxsi iş sənədlərini sorğusuz silə bilər (root verir) */
  canDeleteDocuments: boolean;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt, ip: await clientIp(), userAgent: h.get("user-agent")?.slice(0, 300) ?? null },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Cari istifadəçi (bir sorğu ərzində keşlənir); sessiya yoxdursa və ya bitibsə — null */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    select: { expiresAt: true, user: { select: { id: true, username: true, fullName: true, role: true, isActive: true, canDeleteDocuments: true, departmentId: true, department: { select: { name: true } } } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  const u = session.user;
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, departmentId: u.departmentId, departmentName: u.department?.name ?? null, canDeleteDocuments: u.canDeleteDocuments };
});

/** Səhifələr üçün: giriş yoxdursa /login-ə, icazə yoxdursa /dashboard-a yönləndirir */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/dashboard?denied=1");
  return user;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

/** Server action və API route-lar üçün: yönləndirmə yox, xəta atır */
export async function assertUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Sessiya bitib — yenidən daxil olun", 401);
  if (permission && !can(user.role, permission)) throw new AuthError("Bu əməliyyat üçün icazəniz yoxdur", 403);
  return user;
}

/** API route-ları üçün: istifadəçi və ya hazır 401/403 JSON cavabı */
export async function apiUser(permission?: Permission): Promise<CurrentUser | Response> {
  try {
    return await assertUser(permission);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
