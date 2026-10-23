import type { ImportBatchStatus, Prisma, PrismaClient } from "@prisma/client";
import { getSheet } from "../validation/templates";
import type { TemplateKey } from "../validation/types";
import { commitBatch } from "./committer";
import { streamWorkbook } from "./parser";
import { emit } from "./progress";
import { refreshFileCounters, validateBatch } from "./validator";

/** Növbədəki faylları axınla oxuyur və sətirləri StagingRow cədvəlinə yazır */
export async function parseBatch(db: PrismaClient, batchId: string): Promise<void> {
  const files = await db.importFile.findMany({ where: { batchId, status: "QUEUED" } });
  await emit(batchId, { type: "phase", phase: "parse", message: `${files.length} fayl oxunur` });

  for (const file of files) {
    await db.importFile.update({ where: { id: file.id }, data: { status: "PARSING" } });
    try {
      const { issues, sheets } = await streamWorkbook(file.storagePath, file.templateKey as TemplateKey, async (chunk) => {
        const def = getSheet(chunk.sheetKey);
        await db.stagingRow.createMany({
          data: chunk.rows.map((r) => ({
            batchId,
            fileId: file.id,
            stage: def.stage,
            sheetKey: chunk.sheetKey,
            rowNumber: r.rowNumber,
            data: r.data as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      });
      await db.importFile.update({
        where: { id: file.id },
        data: { fileErrors: issues as unknown as Prisma.InputJsonValue, status: "VALIDATED" },
      });
      for (const s of sheets) await emit(batchId, { type: "file", fileId: file.id, fileName: file.fileName, sheet: s.sheetName, rows: s.rows });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.importFile.update({
        where: { id: file.id },
        data: { status: "FAILED", fileErrors: [{ sheet: "*", severity: "error", message: `Fayl oxuna bilmədi: ${message}` }] },
      });
      await emit(batchId, { type: "error", message: `${file.fileName}: ${message}` });
    }
  }
}

export async function runValidation(db: PrismaClient, batchId: string): Promise<void> {
  await setStatus(db, batchId, "VALIDATING");
  await parseBatch(db, batchId);
  await emit(batchId, { type: "phase", phase: "validate", message: "3 səviyyəli yoxlama (sintaktik → semantik → istinad)" });
  const { invalid } = await validateBatch(db, batchId);
  await setStatus(db, batchId, invalid > 0 ? "NEEDS_REVIEW" : "READY");
}

export async function runCommit(db: PrismaClient, batchId: string, revalidate: boolean): Promise<void> {
  if (revalidate) {
    await setStatus(db, batchId, "VALIDATING");
    await emit(batchId, { type: "phase", phase: "validate", message: "Düzəlişlər yenidən yoxlanılır" });
    await validateBatch(db, batchId);
  }
  await setStatus(db, batchId, "COMMITTING");
  await emit(batchId, { type: "phase", phase: "commit", message: "Topoloji ardıcıllıqla bazaya yazılır" });
  await commitBatch(db, batchId);
  // Commit edilmiş sətirlər yeni kontekstdir — qalan sətirlərin xətalarını yeniləyirik
  await validateBatch(db, batchId);
  await refreshFileCounters(db, batchId);
  const remaining = await db.stagingRow.count({ where: { batchId, status: { in: ["INVALID", "VALID"] } } });
  await setStatus(db, batchId, remaining > 0 ? "NEEDS_REVIEW" : "COMPLETED");
}

async function setStatus(db: PrismaClient, batchId: string, status: ImportBatchStatus) {
  await db.importBatch.update({ where: { id: batchId }, data: { status } });
  await emit(batchId, { type: "status", status });
}
