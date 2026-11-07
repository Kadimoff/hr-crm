import "server-only";
import { prisma } from "@/lib/db";
import type { RegulationDTO } from "@/components/regulations/regulation-view";
import { REGULATION_TEXT_FIELDS, type RegulationKind } from "@/lib/regulation-fields";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Əsasnamə / vəzifə təlimatı səhifəsi və çap üçün ortaq forma */
export async function getRegulationDTO(kind: RegulationKind, id: string): Promise<RegulationDTO | null> {
  const row =
    kind === "charter"
      ? await prisma.departmentCharter.findUnique({ where: { id }, include: { department: { select: { id: true, name: true, code: true } }, createdBy: { select: { fullName: true } }, approvedByUser: { select: { fullName: true } } } })
      : await prisma.jobDescription.findUnique({
          where: { id },
          include: { position: { select: { id: true, name: true, code: true } }, department: { select: { id: true, name: true, code: true } }, createdBy: { select: { fullName: true } }, approvedByUser: { select: { fullName: true } } },
        });
  if (!row) return null;
  const r = row as typeof row & Record<string, unknown>;
  const versions =
    kind === "charter"
      ? await prisma.departmentCharter.findMany({ where: { departmentId: r.departmentId as string }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true, approvedOn: true, effectiveFrom: true, effectiveTo: true } })
      : await prisma.jobDescription.findMany({
          where: { positionId: r.positionId as string, departmentId: (r.departmentId as string | null) ?? null },
          orderBy: { version: "desc" },
          select: { id: true, version: true, status: true, approvedOn: true, effectiveFrom: true, effectiveTo: true },
        });
  const dep = (r as { department?: { id: string; name: string; code: string } | null }).department ?? null;
  const pos = (r as { position?: { id: string; name: string; code: string } }).position;
  const owner =
    kind === "charter"
      ? { label: `${dep!.name} (${dep!.code})`, href: `/structure/${dep!.id}`, departmentId: dep!.id, positionId: null }
      : { label: `${pos!.name}${dep ? ` · ${dep.name}` : " · bütün bölmələr"}`, href: `/positions/${pos!.id}`, departmentId: dep?.id ?? null, positionId: pos!.id };
  return {
    kind,
    id: row.id,
    version: row.version,
    status: row.status,
    title: row.title,
    texts: Object.fromEntries(REGULATION_TEXT_FIELDS[kind].map((f) => [f.key, (r[f.key] as string | null) ?? null])),
    nextReviewOn: kind === "charter" ? iso(r.nextReviewOn as Date | null) : null,
    approvedOn: iso(row.approvedOn),
    approvedBy: row.approvedBy,
    orderNumber: row.orderNumber,
    effectiveFrom: iso(row.effectiveFrom),
    effectiveTo: iso(row.effectiveTo),
    legalReviewText: row.legalReviewText,
    legalReviewDate: iso(row.legalReviewDate),
    legalReviewBy: row.legalReviewBy,
    file: row.fileStoragePath && row.fileName ? { name: row.fileName, size: row.fileSize ?? 0 } : null,
    owner,
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, approvedOn: iso(v.approvedOn), effectiveFrom: iso(v.effectiveFrom), effectiveTo: iso(v.effectiveTo) })),
    createdBy: row.createdBy?.fullName ?? null,
    approvedByUser: row.approvedByUser?.fullName ?? null,
  };
}
