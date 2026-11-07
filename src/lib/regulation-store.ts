import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma, RegulationStatus } from "@prisma/client";
import { DOCUMENTS_DIR } from "@/lib/documents";
import type { RegulationKind } from "@/lib/regulation-fields";

type Tx = Prisma.TransactionClient;

/** Ümumi sətir: hər iki model üçün eyni sahələr */
export interface RegulationRow {
  id: string;
  version: number;
  status: RegulationStatus;
  title: string;
  approvedOn: Date | null;
  approvedBy: string | null;
  orderNumber: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  legalReviewText: string | null;
  legalReviewDate: Date | null;
  legalReviewBy: string | null;
  fileName: string | null;
  fileExtension: string | null;
  fileSize: number | null;
  fileStoragePath: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

/** Prisma delegatı (charter / jd) — eyni API ilə */
export function delegate(tx: Tx, kind: RegulationKind) {
  return (kind === "charter" ? tx.departmentCharter : tx.jobDescription) as unknown as {
    findUnique(a: { where: { id: string } }): Promise<RegulationRow | null>;
    findMany(a: { where: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, boolean> }): Promise<RegulationRow[]>;
    create(a: { data: Record<string, unknown> }): Promise<RegulationRow>;
    update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<RegulationRow>;
  };
}

/** Eyni «sahib» (bölmə; vəzifə + bölmə) üzrə versiyalar */
export const siblingsWhere = (kind: RegulationKind, row: Record<string, unknown>) =>
  kind === "charter" ? { departmentId: row.departmentId as string } : { positionId: row.positionId as string, departmentId: (row.departmentId as string | null) ?? null };

export const ENTITY: Record<RegulationKind, string> = { charter: "DepartmentCharter", jd: "JobDescription" };

const rel = (kind: RegulationKind, id: string, ext: string) => `_org/${kind === "charter" ? "charters" : "job-descriptions"}/${id}.${ext}`;

export async function saveRegulationFile(kind: RegulationKind, id: string, ext: string, buf: Buffer): Promise<string> {
  const r = rel(kind, id, ext);
  await mkdir(path.dirname(path.join(DOCUMENTS_DIR, r)), { recursive: true });
  await writeFile(path.join(DOCUMENTS_DIR, r), buf);
  return r;
}

export const readRegulationFile = (storagePath: string) => readFile(path.join(DOCUMENTS_DIR, storagePath)).catch(() => null);
export const removeRegulationFile = (storagePath: string) => unlink(path.join(DOCUMENTS_DIR, storagePath)).catch(() => undefined);
