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

const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const updateSchema = withDepartmentRule(
  baseSchema.extend({
    id: z.string().min(1),
    isActive: checkbox,
    canDeleteDocuments: checkbox,
    /** Maaş məxfiliyi: hesabın sahibi olan əməkdaşın kodu (boş — bağlantı yoxdur) */
    personCode: z.preprocess(blank, z.string().trim().max(64).optional()),
    canViewRestrictedSalaries: checkbox,
    canApproveCharters: checkbox,
  }),
);

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
      // İlk girişdə istifadəçi root-un verdiyi şifrəni özününkü ilə əvəz etməlidir
      data: {
        username,
        fullName,
        role,
        departmentId: role === "DEPT_HEAD" ? departmentId : null,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        createdById: actor.id,
      },
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
  // Root həmişə birbaşa silir — bayraq yalnız digər rollar üçündür
  const canDeleteDocuments = role !== "ROOT" && parsed.data.canDeleteDocuments;
  // Məxfi maaşları görmək: yalnız kadr əməkdaşına verilir (root həmişə görür, şöbə rəhbəri heç vaxt)
  const canViewRestrictedSalaries = role === "HR" && parsed.data.canViewRestrictedSalaries;
  // Əsasnamə / vəzifə təlimatını təsdiq: yalnız kadr əməkdaşına verilir (root həmişə təsdiq edir)
  const canApproveCharters = role === "HR" && parsed.data.canApproveCharters;
  // «personCode» — «Kod — Ad» siyahısından seçilib: kod birinci hissədir
  const code = parsed.data.personCode?.split(/\s+—\s+/)[0]?.trim();
  const person = code ? await prisma.person.findUnique({ where: { code }, select: { id: true, fullName: true, code: true } }) : null;
  if (code && !person) return { fieldErrors: { personCode: "Bu kodla əməkdaş tapılmadı" } };
  if (person) {
    const taken = await prisma.user.findFirst({ where: { personId: person.id, id: { not: id } }, select: { username: true } });
    if (taken) return { fieldErrors: { personCode: `Bu əməkdaş artıq @${taken.username} hesabına bağlıdır` } };
  }

  const before = await prisma.user.findUnique({ where: { id }, include: { department: { select: { name: true } }, person: { select: { code: true, fullName: true } } } });
  if (!before) return { error: "İstifadəçi tapılmadı" };
  if (id === actor.id && (role !== "ROOT" || !isActive)) return { error: "Öz hesabınızın rolunu dəyişə və ya onu deaktiv edə bilməzsiniz" };
  if (before.role === "ROOT" && (role !== "ROOT" || !isActive)) {
    const roots = await prisma.user.count({ where: { role: "ROOT", isActive: true, id: { not: id } } });
    if (roots === 0) return { error: "Sistemdə ən azı bir aktiv root qalmalıdır" };
  }

  const after = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { fullName, role, isActive, canDeleteDocuments, departmentId: role === "DEPT_HEAD" ? departmentId : null, personId: person?.id ?? null, canViewRestrictedSalaries, canApproveCharters },
      include: { department: { select: { name: true } }, person: { select: { code: true, fullName: true } } },
    });
    // Deaktiv edilən və ya rolu dəyişən istifadəçinin açıq sessiyaları bağlanır
    // (maaş icazəsi və şəxs bağlantısı hər sorğuda DB-dən oxunur — dərhal qüvvəyə minir)
    if (!isActive || role !== before.role) await tx.session.deleteMany({ where: { userId: id } });
    return u;
  });
  const personLabel = (p: { code: string; fullName: string } | null) => (p ? `${p.code} — ${p.fullName}` : null);
  const changes = diff(
    {
      fullName: before.fullName,
      role: before.role,
      department: before.department?.name ?? null,
      isActive: before.isActive,
      canDeleteDocuments: before.canDeleteDocuments,
      person: personLabel(before.person),
      canViewRestrictedSalaries: before.canViewRestrictedSalaries,
      canApproveCharters: before.canApproveCharters,
    },
    {
      fullName: after.fullName,
      role: after.role,
      department: after.department?.name ?? null,
      isActive: after.isActive,
      canDeleteDocuments: after.canDeleteDocuments,
      person: personLabel(after.person),
      canViewRestrictedSalaries: after.canViewRestrictedSalaries,
      canApproveCharters: after.canApproveCharters,
    },
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
  // Başqasının şifrəsini sıfırlayanda — həmin istifadəçi növbəti girişdə öz şifrəsini təyin etməlidir
  const forceChange = id !== actor.id;
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: forceChange, ...(forceChange ? {} : { passwordChangedAt: new Date() }) } }),
    // Köhnə şifrə ilə açılmış sessiyalar etibarsız olur (öz sessiyası istisna)
    prisma.session.deleteMany({ where: { userId: id, ...(id === actor.id ? { NOT: { userId: actor.id } } : {}) } }),
  ]);
  await audit({ user: actor, action: "PASSWORD_RESET", entity: "User", entityId: id, summary: `Şifrə yeniləndi: @${user.username}${forceChange ? " (növbəti girişdə dəyişməlidir)" : ""}` });
  return { ok: true };
}
