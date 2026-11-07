"use server";

import { Prisma, type DepartmentChangeKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit, diff, snapshot } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { applyChange, closeImpact, StructureError, subtreeInfo } from "@/lib/department-changes";
import { CHANGE_KIND_LABELS, changeFields, closeBlockers, DEPARTMENT_KINDS, isFutureDated, MAX_DEPT_LEVEL, moveError, syncKindFlags, type CloseImpact } from "@/lib/org-structure";
import { isSalaryPrivileged } from "@/lib/salary-privacy";
import { restrictedDepartmentIds } from "@/lib/salary-restriction";
import { formatAzDate } from "@/lib/validation/primitives";

export interface DeptFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Yeni yaradılan bölmənin id-si — xəritədə valideyni açmaq üçün */
  id?: string;
  /** Məlumat mesajı (məs. «planlaşdırıldı») */
  message?: string;
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optText = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarix yanlışdır")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Tarix yanlışdır");
const optDay = z.preprocess(blank, isoDay.optional());
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());

/** Köhnə forma dəyərləri (faculty / chair / unit) də qəbul olunur */
const LEGACY_KIND: Record<string, (typeof DEPARTMENT_KINDS)[number] | null> = { faculty: "FAKULTE", chair: "KAFEDRA", unit: null };

const schema = z.object({
  id: z.preprocess(blank, z.string().optional()),
  parentId: z.preprocess(blank, z.string().optional()),
  code: z.string().trim().regex(/^\S{1,32}$/, "Kod boşluqsuz olmalıdır (ən çox 32 simvol)"),
  name: z.string().trim().min(2, "Adı daxil edin").max(300),
  kind: z.preprocess(blank, z.string().optional()).transform((v, ctx) => {
    if (v === undefined || v === "" || v === "none") return null;
    if (v in LEGACY_KIND) return LEGACY_KIND[v]!;
    if ((DEPARTMENT_KINDS as string[]).includes(v)) return v as (typeof DEPARTMENT_KINDS)[number];
    ctx.addIssue({ code: "custom", message: "Növü seçin" });
    return z.NEVER;
  }),
  createdOn: isoDay,
  sortOrder: z.preprocess(blank, z.coerce.number({ invalid_type_error: "Tam ədəd daxil edin" }).int("Tam ədəd daxil edin").min(0).max(100000).optional()),
  isExternal: checkbox,
  isGroup: checkbox,
  headPositionTitle: optText(),
  campus: optText(),
  budgetCenter: optText(),
});

const fail = (e: unknown): DeptFormState => ({ error: e instanceof AuthError || e instanceof StructureError || e instanceof Error ? e.message : "Gözlənilməz xəta" });

const revalidate = () => {
  revalidatePath("/org-chart");
  revalidatePath("/structure", "layout");
  revalidatePath("/dashboard");
};

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
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
    const flags = syncKindFlags({ kind: v.kind });
    // «Maaşlar məxfidir» işarəsi yalnız root / səlahiyyətli hesabın formasında var; başqasından gəlsə — rədd
    const salaryField = form.get("salaryRestrictedField") === "1";
    if (salaryField && !isSalaryPrivileged(user)) throw new AuthError("Maaş məxfiliyini yalnız root və ya səlahiyyətli hesab dəyişə bilər", 403);
    const salaryRestricted = salaryField ? form.get("salaryRestricted") === "on" : undefined;
    // Yeni sahələr formada yoxdursa (köhnə forma) — toxunulmur
    const extended = form.has("extendedFields");
    const extra = extended
      ? {
          sortOrder: v.sortOrder ?? null,
          isExternal: v.isExternal,
          isGroup: v.isGroup,
          headPositionTitle: v.headPositionTitle ?? null,
          campus: v.campus ?? null,
          budgetCenter: v.budgetCenter ?? null,
        }
      : {};

    if (v.id) {
      const before = await prisma.department.findUnique({ where: { id: v.id } });
      if (!before) return { error: "Bölmə tapılmadı" };
      const data = { code: v.code, name: v.name, createdOn: v.createdOn, ...flags, ...extra, ...(salaryRestricted !== undefined ? { salaryRestricted } : {}) };
      const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(data).map((k) => [k, o[k]]));
      const changes = diff(snapshot(pick(before as unknown as Record<string, unknown>)), snapshot(data));
      if (Object.keys(changes).length === 0) return { ok: true, id: v.id };
      await prisma.$transaction(async (tx) => {
        await tx.department.update({ where: { id: v.id }, data });
        // Ad dəyişikliyi struktur tarixçəsinə (bu gündən qüvvədə); gələcək tarixli ad dəyişikliyi — «Planlaşdır» ilə
        if (before.name !== v.name)
          await tx.departmentChange.create({
            data: { departmentId: before.id, kind: "RENAME", effectiveDate: todayUtc(), before: { name: before.name }, after: { name: v.name }, source: "UI", appliedAt: new Date(), createdById: user.id },
          });
        await audit({ user, action: "UPDATE", entity: "Department", entityId: v.id, summary: `Struktur bölməsi dəyişdirildi: ${v.name}`, changes: changes as Prisma.InputJsonValue }, tx);
      });
      revalidate();
      return { ok: true, id: v.id };
    }

    const parent = v.parentId ? await prisma.department.findUnique({ where: { id: v.parentId }, select: { id: true, level: true, name: true, closedOn: true } }) : null;
    if (v.parentId && !parent) return { error: "Üst bölmə tapılmadı" };
    if (parent?.closedOn && parent.closedOn <= todayUtc()) return { error: "Bağlanmış bölməyə alt bölmə əlavə edilə bilməz" };
    const level = parent ? parent.level + 1 : 1;
    if (level > MAX_DEPT_LEVEL) return { error: `Struktur ən çox ${MAX_DEPT_LEVEL} səviyyəli ola bilər` };
    const created = await prisma.$transaction(async (tx) => {
      const d = await tx.department.create({
        data: { code: v.code, name: v.name, level, parentId: parent?.id ?? null, createdOn: v.createdOn, ...flags, ...extra, salaryRestricted: salaryRestricted ?? false },
      });
      await tx.departmentChange.create({
        data: { departmentId: d.id, kind: "CREATE", effectiveDate: v.createdOn, after: changeFields(d) as Prisma.InputJsonValue, source: "UI", appliedAt: new Date(), createdById: user.id },
      });
      await audit(
        {
          user,
          action: "CREATE",
          entity: "Department",
          entityId: d.id,
          summary: `Yeni struktur bölməsi: ${v.name}${parent ? ` (${parent.name} daxilində)` : ""}`,
          changes: snapshot({ code: v.code, name: v.name, level, parent: parent?.name ?? null, kind: flags.kind, ...(salaryRestricted ? { salaryRestricted } : {}) }) as Prisma.InputJsonValue,
        },
        tx,
      );
      return d;
    });
    revalidate();
    return { ok: true, id: created.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Bu kodla bölmə artıq mövcuddur", fieldErrors: { code: "Kod təkrarlanır" } };
    return fail(e);
  }
}

/** Yalnız boş bölmə silinir: alt bölməsi, müqaviləsi (arxiv daxil), ştat vahidi, əsasnaməsi və vəzifə təlimatı olmamalıdır */
export async function deleteDepartmentAction(id: string): Promise<DeptFormState> {
  try {
    const user = await assertUser("structure.edit");
    const d = await prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { children: true, employments: true, staffingUnits: true, charters: true, jobDescriptions: true } } },
    });
    if (!d) return { error: "Bölmə tapılmadı" };
    const { children, employments, staffingUnits, charters, jobDescriptions } = d._count;
    if (children || employments || staffingUnits || charters || jobDescriptions) {
      const parts = [
        children && `${children} alt bölmə`,
        employments && `${employments} müqavilə`,
        staffingUnits && `${staffingUnits} ştat sətri`,
        charters && `${charters} əsasnamə`,
        jobDescriptions && `${jobDescriptions} vəzifə təlimatı`,
      ].filter(Boolean);
      return { error: `Bölmə boş deyil: ${parts.join(", ")}. Silmək əvəzinə bölməni bağlayın (struktur dəyişikliyi) — tarixçə saxlanılır.` };
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

// ----------------------------------------------------------------------------
//  Struktur dəyişiklikləri (TZ M01-01, M01-03): ad, tabelik, bağlanma, birləşmə — bu gün və ya gələcək tarixlə
// ----------------------------------------------------------------------------

const changeSchema = z.object({
  departmentId: z.string().min(1, "Bölməni seçin"),
  kind: z.enum(["RENAME", "MOVE", "CLOSE", "MERGE"], { errorMap: () => ({ message: "Dəyişikliyin növünü seçin" }) }),
  effectiveDate: z.preprocess(blank, z.string({ required_error: "Qüvvəyə minmə tarixini daxil edin" }).pipe(isoDay)),
  orderNumber: optText(64),
  orderDate: optDay,
  newName: optText(300),
  /** MOVE: yeni üst bölmə; «root» — 1-ci səviyyə */
  newParentId: z.preprocess(blank, z.string().optional()),
  targetDepartmentId: z.preprocess(blank, z.string().optional()),
  note: optText(1000),
});

export interface ImpactResult {
  ok: boolean;
  error?: string;
  impact?: CloseImpact;
  blockers?: string[];
}

/** Bağlanma / birləşmədən əvvəl əlaqələrin siyahısı (M01-03): aktiv təyinat, açıq alt bölmə, ştat, sənəd, rəhbər hesabı */
export async function closeImpactAction(departmentId: string, effectiveDate?: string): Promise<ImpactResult> {
  try {
    await assertUser("structure.edit");
    const day = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? new Date(`${effectiveDate}T00:00:00Z`) : todayUtc();
    const impact = await closeImpact(prisma, departmentId, day);
    return { ok: true, impact, blockers: closeBlockers(impact) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Xəta" };
  }
}

export async function scheduleDepartmentChangeAction(_prev: DeptFormState, form: FormData): Promise<DeptFormState> {
  try {
    const user = await assertUser("structure.edit");
    const parsed = changeSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
      return { error: "Formada xətalar var", fieldErrors };
    }
    const v = parsed.data;
    const today = todayUtc();
    const dept = await prisma.department.findUnique({
      where: { id: v.departmentId },
      select: { id: true, code: true, name: true, parentId: true, closedOn: true, level: true, createdOn: true },
    });
    if (!dept) return { error: "Bölmə tapılmadı", fieldErrors: { departmentId: "Bölmə tapılmadı" } };
    if (dept.closedOn && dept.closedOn <= today) return { error: "Bölmə artıq bağlanıb", fieldErrors: { departmentId: "Bölmə bağlanıb" } };
    if (v.effectiveDate < dept.createdOn) return { error: "Qüvvəyə minmə tarixi bölmənin yaradılma tarixindən əvvəl ola bilməz", fieldErrors: { effectiveDate: "Tarix yanlışdır" } };
    if (v.orderDate && v.orderDate > today) return { error: "Əmrin tarixi gələcəkdə ola bilməz", fieldErrors: { orderDate: "Gələcək tarix" } };
    const future = isFutureDated(v.effectiveDate, today);

    // Eyni bölmədə eyni növlü gözləyən dəyişiklik varsa — əvvəlcə onu ləğv etmək lazımdır
    const pendingSame = await prisma.departmentChange.findFirst({ where: { departmentId: dept.id, kind: v.kind, appliedAt: null, cancelledAt: null } });
    if (pendingSame) return { error: `Bu bölmə üçün artıq ${formatAzDate(pendingSame.effectiveDate)} tarixinə planlaşdırılmış «${CHANGE_KIND_LABELS[v.kind]}» var — əvvəlcə onu ləğv edin` };

    let after: Record<string, unknown> = {};
    let targetDepartmentId: string | null = null;
    switch (v.kind) {
      case "RENAME":
        if (!v.newName) return { error: "Yeni adı daxil edin", fieldErrors: { newName: "Yeni adı daxil edin" } };
        if (v.newName === dept.name) return { error: "Yeni ad cari adla eynidir", fieldErrors: { newName: "Ad dəyişmir" } };
        after = { name: v.newName };
        break;
      case "MOVE": {
        const parentId = !v.newParentId || v.newParentId === "root" ? null : v.newParentId;
        if (parentId === dept.parentId) return { error: "Bölmə artıq bu bölməyə tabedir", fieldErrors: { newParentId: "Tabelik dəyişmir" } };
        const parent = parentId ? await prisma.department.findUnique({ where: { id: parentId }, select: { id: true, level: true, closedOn: true } }) : null;
        if (parentId && !parent) return { error: "Yeni üst bölmə tapılmadı", fieldErrors: { newParentId: "Tapılmadı" } };
        if (parent?.closedOn && parent.closedOn <= v.effectiveDate) return { error: "Yeni üst bölmə həmin tarixdə bağlı olacaq", fieldErrors: { newParentId: "Bağlı bölmə" } };
        const sub = await subtreeInfo(prisma, dept.id);
        const err = moveError({ id: dept.id, newParentId: parentId, newParentLevel: parent?.level ?? 0, subtreeIds: sub.ids, subtreeDepth: sub.depth });
        if (err) return { error: err, fieldErrors: { newParentId: err } };
        // Maaş məxfiliyi: məxfi bölməni məxfi olmayan bölməyə imtiyazsız hesab köçürə bilməz (idxaldakı qayda ilə eyni)
        if (!isSalaryPrivileged(user)) {
          const restricted = await restrictedDepartmentIds(prisma);
          if (restricted.has(dept.id) && !(parentId && restricted.has(parentId))) throw new AuthError("Maaşları məxfi olan bölmənin tabeliyini yalnız root və ya səlahiyyətli hesab dəyişə bilər", 403);
        }
        after = { parentId };
        break;
      }
      case "MERGE": {
        if (!v.targetDepartmentId || v.targetDepartmentId === dept.id) return { error: "Birləşdiyi bölməni seçin", fieldErrors: { targetDepartmentId: "Bölməni seçin" } };
        const target = await prisma.department.findUnique({ where: { id: v.targetDepartmentId }, select: { id: true, closedOn: true } });
        if (!target || (target.closedOn && target.closedOn <= v.effectiveDate)) return { error: "Birləşdiyi bölmə mövcud deyil və ya bağlanır", fieldErrors: { targetDepartmentId: "Yanlış bölmə" } };
        const sub = await subtreeInfo(prisma, dept.id);
        if (sub.ids.has(target.id)) return { error: "Bölmə öz alt bölməsi ilə birləşdirilə bilməz", fieldErrors: { targetDepartmentId: "Alt bölmə" } };
        targetDepartmentId = target.id;
        after = { closedOn: v.effectiveDate.toISOString().slice(0, 10) };
        break;
      }
      case "CLOSE":
        after = { closedOn: v.effectiveDate.toISOString().slice(0, 10) };
        break;
    }

    // Bağlanma / birləşmə: aktiv müqavilə və açıq alt bölmə — bu gün tətbiqdə rədd; gələcək tarixdə planlaşdırılır,
    // amma tarix çatanda da yoxlanılır (həll olunmayıbsa dəyişiklik gözləməkdə qalır) — xəbərdarlıq qaytarılır
    let warning = "";
    if (v.kind === "CLOSE" || v.kind === "MERGE") {
      const blockers = closeBlockers(await closeImpact(prisma, dept.id, v.effectiveDate));
      if (blockers.length && !future) return { error: `Bölmə bağlana bilməz: ${blockers.join("; ")}` };
      if (blockers.length) warning = ` Diqqət: ${blockers.join("; ")} — tarixə qədər həll edilməsə, dəyişiklik tətbiq olunmayacaq.`;
    }

    const id = await prisma.$transaction(async (tx) => {
      const c = await tx.departmentChange.create({
        data: {
          departmentId: dept.id,
          kind: v.kind as DepartmentChangeKind,
          effectiveDate: v.effectiveDate,
          orderNumber: v.orderNumber ?? null,
          orderDate: v.orderDate ?? null,
          before: changeFields(dept) as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
          targetDepartmentId,
          note: v.note ?? null,
          source: "UI",
          createdById: user.id,
        },
      });
      // Bu gün və ya keçmiş tarix — dərhal tətbiq; gələcək tarix — cari struktur DƏYİŞMİR (M01-01 qəbul meyarı)
      if (!future) await applyChange(tx, c);
      await audit(
        {
          user,
          action: "UPDATE",
          entity: "Department",
          entityId: dept.id,
          summary: `Struktur dəyişikliyi ${future ? "planlaşdırıldı" : "tətbiq olundu"}: ${dept.name} (${dept.code}) — ${CHANGE_KIND_LABELS[v.kind]}, ${formatAzDate(v.effectiveDate)}`,
          changes: { changeId: c.id, before: changeFields(dept), after, ...(v.orderNumber ? { orderNumber: v.orderNumber } : {}) } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      return c.id;
    });
    revalidate();
    return {
      ok: true,
      id,
      message: future ? `Dəyişiklik ${formatAzDate(v.effectiveDate)} tarixinə planlaşdırıldı — cari struktur dəyişmədi.${warning}` : "Dəyişiklik tətbiq olundu",
    };
  } catch (e) {
    return fail(e);
  }
}

/** Planlaşdırılmış (hələ tətbiq olunmamış) dəyişikliyin ləğvi — tarixçədə «ləğv edilib» kimi qalır */
export async function cancelDepartmentChangeAction(id: string): Promise<DeptFormState> {
  try {
    const user = await assertUser("structure.edit");
    const c = await prisma.departmentChange.findUnique({ where: { id }, include: { department: { select: { name: true, code: true } } } });
    if (!c) return { error: "Dəyişiklik tapılmadı" };
    if (c.appliedAt) return { error: "Tətbiq olunmuş dəyişiklik ləğv edilə bilməz — yeni dəyişiklik yaradın" };
    if (c.cancelledAt) return { ok: true };
    await prisma.$transaction(async (tx) => {
      await tx.departmentChange.update({ where: { id }, data: { cancelledAt: new Date() } });
      await audit(
        { user, action: "UPDATE", entity: "Department", entityId: c.departmentId, summary: `Planlaşdırılmış struktur dəyişikliyi ləğv edildi: ${c.department.name} (${c.department.code}) — ${CHANGE_KIND_LABELS[c.kind]}, ${formatAzDate(c.effectiveDate)}` },
        tx,
      );
    });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
