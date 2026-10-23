"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { assertUser } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { prisma } from "@/lib/db";

export interface UserFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const baseSchema = z.object({
  fullName: z.string().trim().min(3, "Ad, soyad daxil edin").max(120),
  role: z.enum(["ROOT", "HR", "DEPT_HEAD"], { errorMap: () => ({ message: "Rolu seçin" }) }),
  departmentId: z.preprocess(blank, z.string().optional()),
});

const withDepartmentRule = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((v: { role: string; departmentId?: string }, ctx) => {
    if (v.role === "DEPT_HEAD" && !v.departmentId) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Şöbə rəhbəri üçün struktur bölmə seçilməlidir" });
  });

const createSchema = withDepartmentRule(
  baseSchema.extend({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "3–32 simvol: latın hərfləri, rəqəm, . _ -"),
    password: z.string().superRefine((p, ctx) => {
      const problem = passwordProblem(p);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  }),
);

const updateSchema = withDepartmentRule(baseSchema.extend({ id: z.string().min(1), isActive: z.preprocess((v) => v === "on" || v === "true", z.boolean()) }));

const fieldErrors = (e: z.ZodError) => {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0])] ??= i.message;
  return out;
};

export async function createUserAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const actor = await assertUser("users.manage");
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { username, fullName, role, departmentId, password } = parsed.data;
  try {
    const user = await prisma.user.create({
      data: { username, fullName, role, departmentId: role === "DEPT_HEAD" ? departmentId : null, passwordHash: await hashPassword(password), createdById: actor.id },
      include: { department: { select: { name: true } } },
    });
    await audit({
      user: actor,
      action: "CREATE",
      entity: "User",
      entityId: user.id,
      summary: `İstifadəçi yaradıldı: @${username} (${role}${user.department ? `, ${user.department.name}` : ""})`,
      changes: { username, fullName, role, department: user.department?.name ?? null },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { fieldErrors: { username: "Bu istifadəçi adı artıq mövcuddur" } };
    throw e;
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUserAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const actor = await assertUser("users.manage");
  const parsed = updateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { id, fullName, role, departmentId, isActive } = parsed.data;

  const before = await prisma.user.findUnique({ where: { id }, include: { department: { select: { name: true } } } });
  if (!before) return { error: "İstifadəçi tapılmadı" };
  if (id === actor.id && (role !== "ROOT" || !isActive)) return { error: "Öz hesabınızın rolunu dəyişə və ya onu deaktiv edə bilməzsiniz" };
  if (before.role === "ROOT" && (role !== "ROOT" || !isActive)) {
    const roots = await prisma.user.count({ where: { role: "ROOT", isActive: true, id: { not: id } } });
    if (roots === 0) return { error: "Sistemdə ən azı bir aktiv root qalmalıdır" };
  }

  const after = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { fullName, role, isActive, departmentId: role === "DEPT_HEAD" ? departmentId : null },
      include: { department: { select: { name: true } } },
    });
    // Deaktiv edilən və ya rolu dəyişən istifadəçinin açıq sessiyaları bağlanır
    if (!isActive || role !== before.role) await tx.session.deleteMany({ where: { userId: id } });
    return u;
  });
  const changes = diff(
    { fullName: before.fullName, role: before.role, department: before.department?.name ?? null, isActive: before.isActive },
    { fullName: after.fullName, role: after.role, department: after.department?.name ?? null, isActive: after.isActive },
  );
  if (Object.keys(changes).length) {
    await audit({ user: actor, action: "UPDATE", entity: "User", entityId: id, summary: `İstifadəçi dəyişdirildi: @${before.username}`, changes: changes as Prisma.InputJsonValue });
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function resetPasswordAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const actor = await assertUser("users.manage");
  const id = String(form.get("id") ?? "");
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { fieldErrors: { password: problem } };
  const user = await prisma.user.findUnique({ where: { id }, select: { username: true } });
  if (!user) return { error: "İstifadəçi tapılmadı" };
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } }),
    // Köhnə şifrə ilə açılmış sessiyalar etibarsız olur (öz sessiyası istisna)
    prisma.session.deleteMany({ where: { userId: id, ...(id === actor.id ? { NOT: { userId: actor.id } } : {}) } }),
  ]);
  await audit({ user: actor, action: "PASSWORD_RESET", entity: "User", entityId: id, summary: `Şifrə yeniləndi: @${user.username}` });
  return { ok: true };
}
