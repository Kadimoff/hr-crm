import "server-only";
import type { ImportStage, StagingRowStatus } from "@prisma/client";
import { prisma } from "./db";
import { STAGE_ORDER } from "./validation/stages";
import { getSheet, TEMPLATES } from "./validation/templates";
import type { SheetKey, TemplateKey } from "./validation/types";

export async function getBatchSnapshot(batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { files: { orderBy: { createdAt: "asc" } } } });
  if (!batch) return null;
  const groups = await prisma.stagingRow.groupBy({ by: ["stage", "sheetKey", "status"], where: { batchId }, _count: { _all: true } });

  const empty = (): Record<StagingRowStatus, number> => ({ PENDING: 0, VALID: 0, INVALID: 0, COMMITTED: 0 });
  const stages = STAGE_ORDER.map((stage) => ({ stage, counts: empty() }));
  const sheets = new Map<SheetKey, { sheetKey: SheetKey; title: string; stage: ImportStage; counts: Record<StagingRowStatus, number> }>();
  for (const g of groups) {
    stages.find((s) => s.stage === g.stage)!.counts[g.status] += g._count._all;
    const key = g.sheetKey as SheetKey;
    const entry = sheets.get(key) ?? { sheetKey: key, title: getSheet(key).title, stage: g.stage, counts: empty() };
    entry.counts[g.status] += g._count._all;
    sheets.set(key, entry);
  }

  return {
    id: batch.id,
    status: batch.status,
    createdAt: batch.createdAt.toISOString(),
    files: batch.files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      templateKey: f.templateKey as TemplateKey,
      templateNumber: TEMPLATES[f.templateKey as TemplateKey].number,
      status: f.status,
      totalRows: f.totalRows,
      validRows: f.validRows,
      invalidRows: f.invalidRows,
      committedRows: f.committedRows,
      fileErrors: f.fileErrors as { sheet: string; severity: "error" | "warning"; message: string }[],
    })),
    stages,
    sheets: [...sheets.values()].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)),
  };
}

export type BatchSnapshot = NonNullable<Awaited<ReturnType<typeof getBatchSnapshot>>>;
