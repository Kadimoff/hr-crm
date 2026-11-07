"use server";

import type { Prisma, RegulationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canApproveRegulations } from "@/lib/auth/roles";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit, diff, snapshot } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createAcksForApproved } from "@/lib/job-description-acks";
import { REGULATION_TEXT_FIELDS, REGULATION_TITLES, regulationHref, type RegulationKind } from "@/lib/regulation-fields";
import { delegate, ENTITY, siblingsWhere } from "@/lib/regulation-store";
import { assertEditable, nextVersion, openDraft, REGULATION_STATUS_LABELS, RegulationError, supersede, transitionError } from "@/lib/regulations";

export interface RegulationFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
  message?: string;
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarix yanlışdır")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Tarix yanlışdır");
const optDay = z.preprocess(blank, isoDay.optional());
const kindSchema = z.enum(["charter", "jd"]);

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

const fail = (e: unknown): RegulationFormState => ({ error: e instanceof AuthError || e instanceof RegulationError ? e.message : e instanceof Error ? e.message : "Gözlənilməz xəta" });

function revalidate(kind: RegulationKind, id?: string) {
  if (kind === "charter") {
    revalidatePath("/structure", "layout");
    revalidatePath("/org-chart");
  } else revalidatePath("/positions", "layout");
  if (id) revalidatePath(regulationHref(kind, id));
}

const fieldErrors = (e: z.ZodError) => {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0])] ??= i.message;
  return out;
};

/**
 * Yeni versiya (qaralama): əsasnamə — bölmə üzrə; vəzifə təlimatı — vəzifə (+ könüllü bölmə) üzrə.
 * copyFromId — mövcud versiyanın mətni köçürülür (təsdiqlənmiş versiya dəyişdirilmir, yenisi yaradılır).
 */
export async function createRegulationAction(kind: RegulationKind, owner: { departmentId?: string | null; positionId?: string }, copyFromId?: string): Promise<RegulationFormState> {
  try {
    const user = await assertUser("charter.edit");
    kindSchema.parse(kind);
    const id = await prisma.$transaction(async (tx) => {
      const d = delegate(tx, kind);
      let ownerKey: Record<string, unknown>;
      let label: string;
      if (kind === "charter") {
        const dep = owner.departmentId ? await tx.department.findUnique({ where: { id: owner.departmentId }, select: { id: true, name: true, code: true } }) : null;
        if (!dep) throw new RegulationError("Bölmə tapılmadı");
        ownerKey = { departmentId: dep.id };
        label = `${dep.name} (${dep.code})`;
      } else {
        const pos = owner.positionId ? await tx.position.findUnique({ where: { id: owner.positionId }, select: { id: true, name: true, code: true } }) : null;
        if (!pos) throw new RegulationError("Vəzifə tapılmadı");
        const dep = owner.departmentId ? await tx.department.findUnique({ where: { id: owner.departmentId }, select: { id: true, name: true } }) : null;
        if (owner.departmentId && !dep) throw new RegulationError("Bölmə tapılmadı");
        ownerKey = { positionId: pos.id, departmentId: dep?.id ?? null };
        label = `${pos.name}${dep ? ` · ${dep.name}` : ""}`;
      }
      const versions = await d.findMany({ where: ownerKey, select: { id: true, version: true, status: true } as Record<string, boolean> });
      const draft = openDraft(versions);
      if (draft) throw new RegulationError(`Açıq qaralama artıq var (v${draft.version}) — onu redaktə edin və ya təsdiqləyin`);
      const src = copyFromId ? await d.findUnique({ where: { id: copyFromId } }) : null;
      const copy = src ? Object.fromEntries(REGULATION_TEXT_FIELDS[kind].map((f) => [f.key, src[f.key] ?? null])) : {};
      const version = nextVersion(versions);
      const created = await d.create({
        data: {
          ...ownerKey,
          version,
          status: "QARALAMA",
          title: src?.title ?? `${REGULATION_TITLES[kind].one} — ${label}`,
          ...copy,
          ...(kind === "charter" && src ? { nextReviewOn: (src.nextReviewOn as Date | null) ?? null } : {}),
          createdById: user.id,
        },
      });
      await audit({ user, action: "CREATE", entity: ENTITY[kind], entityId: created.id, summary: `${REGULATION_TITLES[kind].one} — yeni versiya v${version} (qaralama): ${label}` }, tx);
      return created.id;
    });
    revalidate(kind, id);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/** Qaralama / hüquqi rəydə olan versiyanın mətni (təsdiqlənmiş — dəyişdirilmir) */
export async function saveRegulationAction(_prev: RegulationFormState, form: FormData): Promise<RegulationFormState> {
  try {
    const user = await assertUser("charter.edit");
    const kind = kindSchema.parse(form.get("kind"));
    const shape: Record<string, z.ZodTypeAny> = {
      id: z.string().min(1),
      title: z.preprocess(blank, z.string({ required_error: "Adı daxil edin" }).trim().min(3, "Adı daxil edin").max(300)),
      legalReviewText: text(4000),
      legalReviewDate: optDay,
      legalReviewBy: text(200),
      ...(kind === "charter" ? { nextReviewOn: optDay } : {}),
    };
    for (const f of REGULATION_TEXT_FIELDS[kind]) shape[f.key] = text(f.long ? 20000 : 500);
    const parsed = z.object(shape).safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "Formada xətalar var", fieldErrors: fieldErrors(parsed.error) };
    const { id, ...v } = parsed.data as Record<string, unknown> & { id: string };
    await prisma.$transaction(async (tx) => {
      const d = delegate(tx, kind);
      const before = await d.findUnique({ where: { id } });
      if (!before) throw new RegulationError("Sənəd tapılmadı");
      assertEditable(before.status);
      const data = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? null]));
      const changes = diff(snapshot(Object.fromEntries(Object.keys(data).map((k) => [k, before[k]]))), snapshot(data));
      if (Object.keys(changes).length === 0) return;
      await d.update({ where: { id }, data });
      await audit({ user, action: "UPDATE", entity: ENTITY[kind], entityId: id, summary: `${REGULATION_TITLES[kind].one} v${before.version} redaktə edildi: ${String(data.title)}`, changes: changes as Prisma.InputJsonValue }, tx);
    });
    revalidate(kind, id);
    return { ok: true, id, message: "Yadda saxlanıldı" };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Status axını: Qaralama → Hüquqi rəydə → Təsdiqlənib → Qüvvədən düşüb (TZ M01-02, M03-02).
 * Təsdiq və qüvvədən salma — yalnız «charter.approve» (ROOT) və ya root-un icazə verdiyi HR hesabı.
 * Təsdiqdə əvvəlki qüvvədə olan versiya avtomatik «Qüvvədən düşüb» olur; vəzifə təlimatında təsirlənən əməkdaşlara
 * yeni tanışlıq tapşırığı yaranır (köhnə tanışlıqlar silinmir).
 */
export async function transitionRegulationAction(_prev: RegulationFormState, form: FormData): Promise<RegulationFormState> {
  try {
    const user = await assertUser("charter.edit");
    const parsed = z
      .object({
        kind: kindSchema,
        id: z.string().min(1),
        to: z.enum(["QARALAMA", "HUQUQI_REYDE", "TESDIQLENIB", "QUVVEDEN_DUSUB"]),
        approvedOn: optDay,
        approvedBy: text(200),
        orderNumber: text(64),
        effectiveFrom: optDay,
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "Formada xətalar var", fieldErrors: fieldErrors(parsed.error) };
    const v = parsed.data;
    const kind = v.kind;
    const today = todayUtc();
    let acks = 0;
    await prisma.$transaction(async (tx) => {
      const d = delegate(tx, kind);
      const row = await d.findUnique({ where: { id: v.id } });
      if (!row) throw new RegulationError("Sənəd tapılmadı");
      const err = transitionError(row.status, v.to as RegulationStatus, canApproveRegulations(user));
      if (err) throw (err.includes("icazə") ? new AuthError(err, 403) : new RegulationError(err));
      const data: Record<string, unknown> = { status: v.to };
      if (v.to === "TESDIQLENIB") {
        const missing: Record<string, string> = {};
        if (!v.approvedOn) missing.approvedOn = "Təsdiq tarixini daxil edin";
        if (!v.approvedBy) missing.approvedBy = "Təsdiq edəni daxil edin";
        if (Object.keys(missing).length) throw Object.assign(new RegulationError("Təsdiq üçün tarix və təsdiq edən məcburidir"), { fields: missing });
        if (v.approvedOn! > today) throw Object.assign(new RegulationError("Təsdiq tarixi gələcəkdə ola bilməz"), { fields: { approvedOn: "Gələcək tarix" } });
        const from = v.effectiveFrom ?? v.approvedOn!;
        Object.assign(data, { approvedOn: v.approvedOn, approvedBy: v.approvedBy, orderNumber: v.orderNumber ?? null, effectiveFrom: from, effectiveTo: null, approvedById: user.id });
        // Əvvəlki qüvvədə olan versiyalar qüvvədən düşür (bitmə tarixi — yeni versiyadan bir gün əvvəl)
        const siblings = await d.findMany({ where: siblingsWhere(kind, row) });
        for (const s of supersede(siblings, row.id, from)) await d.update({ where: { id: s.id }, data: { status: "QUVVEDEN_DUSUB", effectiveTo: s.effectiveTo } });
      }
      if (v.to === "QUVVEDEN_DUSUB") data.effectiveTo = today;
      await d.update({ where: { id: row.id }, data });
      if (v.to === "TESDIQLENIB" && kind === "jd") acks = await createAcksForApproved(tx, row.id);
      await audit(
        {
          user,
          action: "UPDATE",
          entity: ENTITY[kind],
          entityId: row.id,
          summary: `${REGULATION_TITLES[kind].one} v${row.version}: ${REGULATION_STATUS_LABELS[row.status]} → ${REGULATION_STATUS_LABELS[v.to as RegulationStatus]} — ${row.title}${acks ? ` (${acks} tanışlıq tapşırığı)` : ""}`,
          changes: snapshot({ status: [row.status, v.to], ...(v.to === "TESDIQLENIB" ? { approvedOn: v.approvedOn, approvedBy: v.approvedBy, orderNumber: v.orderNumber } : {}) }) as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    revalidate(kind, v.id);
    return { ok: true, id: v.id, message: acks ? `Təsdiqləndi — ${acks} əməkdaşa tanışlıq tapşırığı yaradıldı` : "Status dəyişdirildi" };
  } catch (e) {
    const fields = (e as { fields?: Record<string, string> }).fields;
    return { ...fail(e), ...(fields ? { fieldErrors: fields } : {}) };
  }
}

// ----------------------------------------------------------------------------
//  Vəzifə kataloqu (TZ M03-01) və tanışlıq (M03-02)
// ----------------------------------------------------------------------------

const CLASS_CODES = ["A1", "A2", "N1", "N2", "N3", "N4", "N5"] as const;

export async function savePositionCatalogAction(_prev: RegulationFormState, form: FormData): Promise<RegulationFormState> {
  try {
    const user = await assertUser("charter.edit");
    const parsed = z
      .object({
        id: z.string().min(1),
        jobFamily: text(120),
        classCode: z.preprocess(blank, z.enum(CLASS_CODES, { errorMap: () => ({ message: "A1, A2, N1–N5" }) }).optional()),
        gradeCode: z.preprocess(blank, z.string().trim().regex(/^[\p{L}\d.\-]{1,16}$/u, "Grade kodu: hərf/rəqəm, ən çox 16 simvol").optional()),
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "Formada xətalar var", fieldErrors: fieldErrors(parsed.error) };
    const v = parsed.data;
    const before = await prisma.position.findUnique({ where: { id: v.id }, select: { name: true, jobFamily: true, classCode: true, gradeCode: true } });
    if (!before) return { error: "Vəzifə tapılmadı" };
    const data = { jobFamily: v.jobFamily ?? null, classCode: v.classCode ?? null, gradeCode: v.gradeCode ?? null };
    const changes = diff(snapshot({ jobFamily: before.jobFamily, classCode: before.classCode, gradeCode: before.gradeCode }), snapshot(data));
    if (Object.keys(changes).length) {
      await prisma.position.update({ where: { id: v.id }, data });
      await audit({ user, action: "UPDATE", entity: "Position", entityId: v.id, summary: `Vəzifə kataloqu: ${before.name}`, changes: changes as Prisma.InputJsonValue });
    }
    revalidatePath("/positions", "layout");
    return { ok: true, id: v.id, message: "Yadda saxlanıldı" };
  } catch (e) {
    return fail(e);
  }
}

/** Tanışlığın qeydi: əməkdaş kağız vərəqdə imzalayıb — tarix (və qeyd) HR tərəfindən daxil edilir; boş tarix — geri al */
export async function acknowledgeJobDescriptionAction(ackIds: string[], date: string | null, note?: string): Promise<RegulationFormState> {
  try {
    const user = await assertUser("charter.edit");
    const ids = z.array(z.string().min(1)).min(1).max(1000).parse(ackIds);
    const day = date === null ? null : isoDay.parse(date);
    if (day && day > todayUtc()) return { error: "Tanışlıq tarixi gələcəkdə ola bilməz" };
    const rows = await prisma.jobDescriptionAck.findMany({
      where: { id: { in: ids } },
      include: { jobDescription: { select: { title: true, version: true, status: true } }, employment: { select: { person: { select: { fullName: true, code: true } } } } },
    });
    if (rows.length !== ids.length) return { error: "Tapşırıq tapılmadı" };
    await prisma.$transaction(async (tx) => {
      await tx.jobDescriptionAck.updateMany({
        where: { id: { in: ids } },
        data: { acknowledgedAt: day, acknowledgedById: day ? user.id : null, ...(note !== undefined ? { note: note.trim().slice(0, 500) || null } : {}) },
      });
      await audit(
        {
          user,
          action: "UPDATE",
          entity: "JobDescriptionAck",
          summary:
            rows.length === 1
              ? `Vəzifə təlimatı ilə tanışlıq ${day ? "qeyd edildi" : "geri alındı"}: ${rows[0]!.employment.person.fullName} (${rows[0]!.employment.person.code}) — ${rows[0]!.jobDescription.title} v${rows[0]!.jobDescription.version}`
              : `Vəzifə təlimatı ilə tanışlıq ${day ? "qeyd edildi" : "geri alındı"}: ${rows.length} tapşırıq`,
          changes: { ids, date } as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    revalidatePath("/positions", "layout");
    return { ok: true, message: day ? "Tanışlıq qeyd edildi" : "Geri alındı" };
  } catch (e) {
    return fail(e);
  }
}
