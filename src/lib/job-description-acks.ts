import type { Prisma, PrismaClient } from "@prisma/client";
import { ackTargets, applicableJobDescription } from "./regulations";

/*
 * Vəzifə təlimatı ilə tanışlıq tapşırıqları (TZ M03-02). «server-only» YOX: idxal (worker) də işlədir.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export const ACK_REASON = { NEW_VERSION: "Yeni versiya", HIRE: "İşə qəbul", MOVE: "Köçürmə / vəzifə dəyişikliyi" } as const;

const jdSelect = { id: true, positionId: true, departmentId: true, version: true, status: true } as const;

/** Təlimat təsdiqlənəndə: təsirlənən aktiv müqavilələrə yeni tapşırıq (köhnə tanışlıqlar silinmir). Qaytarır: yaradılan say */
export async function createAcksForApproved(db: Db, jobDescriptionId: string): Promise<number> {
  const jd = await db.jobDescription.findUniqueOrThrow({ where: { id: jobDescriptionId }, select: jdSelect });
  const [all, employments, existing] = await Promise.all([
    db.jobDescription.findMany({ where: { positionId: jd.positionId, status: "TESDIQLENIB" }, select: jdSelect }),
    db.employment.findMany({
      where: { positionId: jd.positionId, status: { not: "TERMINATED" }, person: { deletedAt: null }, ...(jd.departmentId ? { departmentId: jd.departmentId } : {}) },
      select: { id: true, positionId: true, departmentId: true },
    }),
    db.jobDescriptionAck.findMany({ where: { jobDescriptionId }, select: { employmentId: true } }),
  ]);
  const targets = ackTargets(jd, all, employments, new Set(existing.map((a) => a.employmentId)));
  if (targets.length) await db.jobDescriptionAck.createMany({ data: targets.map((employmentId) => ({ jobDescriptionId, employmentId, reason: ACK_REASON.NEW_VERSION })), skipDuplicates: true });
  return targets.length;
}

/**
 * İşə qəbul / köçürmə zamanı: müqaviləyə tətbiq olunan qüvvədə təlimat üçün tapşırıq (artıq varsa — yaradılmır).
 * Qaytarır: yaradılan say.
 */
export async function ensureJobDescriptionAcks(db: Db, employmentIds: string[], reason: string): Promise<number> {
  if (employmentIds.length === 0) return 0;
  const employments = await db.employment.findMany({
    where: { id: { in: employmentIds }, status: { not: "TERMINATED" } },
    select: { id: true, positionId: true, departmentId: true },
  });
  if (employments.length === 0) return 0;
  const jds = await db.jobDescription.findMany({ where: { positionId: { in: [...new Set(employments.map((e) => e.positionId))] }, status: "TESDIQLENIB" }, select: jdSelect });
  const data: { jobDescriptionId: string; employmentId: string; reason: string }[] = [];
  for (const e of employments) {
    const jd = applicableJobDescription(e, jds);
    if (jd) data.push({ jobDescriptionId: jd.id, employmentId: e.id, reason });
  }
  if (data.length === 0) return 0;
  const r = await db.jobDescriptionAck.createMany({ data, skipDuplicates: true });
  return r.count;
}
