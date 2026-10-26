"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit, diff, snapshot } from "@/lib/audit";
import { prisma } from "@/lib/db";

export interface DeptFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Yeni yaradılan bölmənin id-si — xəritədə valideyni açmaq üçün */
  id?: string;
}

const MAX_LEVEL = 4;
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  id: z.preprocess(blank, z.string().optional()),
  parentId: z.preprocess(blank, z.string().optional()),
  code: z.string().trim().regex(/^\S{1,32}$/, "Kod boşluqsuz olmalıdır (ən çox 32 simvol)"),
  name: z.string().trim().min(2, "Adı daxil edin").max(200),
  kind: z.enum(["faculty", "chair", "unit"]),
  createdOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarix yanlışdır")
    .transform((v) => new Date(`${v}T00:00:00Z`)),
});

const fail = (e: unknown): DeptFormState => ({ error: e instanceof AuthError || e instanceof Error ? e.message : "Gözlənilməz xəta" });

const revalidate = () => {
  revalidatePath("/org-chart");
  revalidatePath("/dashboard");
};

export async function saveDepartmentAction(_prev: DeptFormState, form: FormData): Promise<DeptFormState> {
  try {
    const user = await assertUser("structure.edit");
    const parsed = schema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
      return { error: "Formada xətalar var", fieldErrors };
    }
    const v = parsed.data;
    const flags = { isFaculty: v.kind === "faculty", isChair: v.kind === "chair" };

    if (v.id) {
      const before = await prisma.department.findUnique({ where: { id: v.id } });
      if (!before) return { error: "Bölmə tapılmadı" };
      const data = { code: v.code, name: v.name, createdOn: v.createdOn, ...flags };
      const changes = diff(snapshot({ code: before.code, name: before.name, createdOn: before.createdOn, isFaculty: before.isFaculty, isChair: before.isChair }), snapshot(data));
      if (Object.keys(changes).length === 0) return { ok: true, id: v.id };
      await prisma.department.update({ where: { id: v.id }, data });
      await audit({ user, action: "UPDATE", entity: "Department", entityId: v.id, summary: `Struktur bölməsi dəyişdirildi: ${v.name}`, changes: changes as Prisma.InputJsonValue });
      revalidate();
      return { ok: true, id: v.id };
    }

    const parent = v.parentId ? await prisma.department.findUnique({ where: { id: v.parentId }, select: { id: true, level: true, name: true } }) : null;
    if (v.parentId && !parent) return { error: "Üst bölmə tapılmadı" };
    const level = parent ? parent.level + 1 : 1;
    if (level > MAX_LEVEL) return { error: `Struktur ən çox ${MAX_LEVEL} səviyyəli ola bilər` };
    const created = await prisma.department.create({ data: { code: v.code, name: v.name, level, parentId: parent?.id ?? null, createdOn: v.createdOn, ...flags } });
    await audit({
      user,
      action: "CREATE",
      entity: "Department",
      entityId: created.id,
      summary: `Yeni struktur bölməsi: ${v.name}${parent ? ` (${parent.name} daxilində)` : ""}`,
      changes: snapshot({ code: v.code, name: v.name, level, parent: parent?.name ?? null }) as Prisma.InputJsonValue,
    });
    revalidate();
    return { ok: true, id: created.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Bu kodla bölmə artıq mövcuddur", fieldErrors: { code: "Kod təkrarlanır" } };
    return fail(e);
  }
}

/** Yalnız boş bölmə silinir: alt bölməsi, müqaviləsi (arxiv daxil) və ştat vahidi olmamalıdır */
export async function deleteDepartmentAction(id: string): Promise<DeptFormState> {
  try {
    const user = await assertUser("structure.edit");
    const d = await prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { children: true, employments: true, staffingUnits: true } } },
    });
    if (!d) return { error: "Bölmə tapılmadı" };
    const { children, employments, staffingUnits } = d._count;
    if (children || employments || staffingUnits) {
      const parts = [children && `${children} alt bölmə`, employments && `${employments} müqavilə`, staffingUnits && `${staffingUnits} ştat sətri`].filter(Boolean);
      return { error: `Bölmə boş deyil: ${parts.join(", ")}. Əvvəlcə onları köçürün və ya silin.` };
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { departmentId: id }, data: { departmentId: null } });
      await tx.department.delete({ where: { id } });
      await audit({ user, action: "DELETE", entity: "Department", entityId: id, summary: `Struktur bölməsi silindi: ${d.name} (${d.code})`, changes: snapshot({ code: d.code, name: d.name, level: d.level }) as Prisma.InputJsonValue }, tx);
    });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
