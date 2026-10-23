"use server";

import type { Prisma, StagingRowStatus } from "@prisma/client";
import { z } from "zod";
import { assertUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enqueueImport } from "@/lib/queue";
import { SHEETS } from "@/lib/validation/templates";
import type { FieldIssue, RawRow, SheetKey } from "@/lib/validation/types";

const sheetKeySchema = z.enum(Object.keys(SHEETS) as [SheetKey, ...SheetKey[]]);

export interface StagingRowDto {
  id: string;
  rowNumber: number;
  status: StagingRowStatus;
  data: RawRow;
  errors: FieldIssue[];
}

const listSchema = z.object({
  batchId: z.string().min(1),
  sheetKey: sheetKeySchema,
  onlyProblems: z.boolean().default(true),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(10).max(2000).default(500),
});

export async function listStagingRows(input: z.input<typeof listSchema>): Promise<{ rows: StagingRowDto[]; total: number }> {
  await assertUser("import");
  const { batchId, sheetKey, onlyProblems, page, pageSize } = listSchema.parse(input);
  const where: Prisma.StagingRowWhereInput = {
    batchId,
    sheetKey,
    ...(onlyProblems ? { OR: [{ status: "INVALID" }, { status: "VALID", NOT: { errors: { equals: [] } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.stagingRow.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip: page * pageSize,
      take: pageSize,
      select: { id: true, rowNumber: true, status: true, data: true, errors: true },
    }),
    prisma.stagingRow.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, data: r.data as RawRow, errors: r.errors as unknown as FieldIssue[] })),
    total,
  };
}

const editsSchema = z.object({
  batchId: z.string().min(1),
  edits: z
    .array(z.object({ id: z.string().min(1), data: z.record(z.string(), z.string().max(2000)) }))
    .max(5000),
  commit: z.boolean().default(true),
});

/** Grid-də edilmiş düzəlişləri saxlayır və "yenidən yoxla + yaz" işini növbəyə qoyur */
export async function saveEditsAndRevalidate(input: z.input<typeof editsSchema>): Promise<{ ok: true; updated: number }> {
  const user = await assertUser("import");
  const { batchId, edits, commit } = editsSchema.parse(input);
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } });
  if (batch.status === "VALIDATING" || batch.status === "COMMITTING") throw new Error("Batch hazırda emal olunur — bir az gözləyin");

  await prisma.$transaction(
    edits.map((e) =>
      prisma.stagingRow.update({
        // COMMITTED sətirlər dəyişdirilə bilməz
        where: { id: e.id, batchId, status: { not: "COMMITTED" } },
        data: { data: e.data, status: "PENDING", errors: [] },
      }),
    ),
  );
  await enqueueImport({ kind: commit ? "revalidate-commit" : "validate", batchId });
  await audit({ user, action: "UPDATE", entity: "ImportBatch", entityId: batchId, summary: `İdxal xətaları düzəldildi: ${edits.length} sətir${commit ? ", bazaya yazılır" : ""}` });
  return { ok: true, updated: edits.length };
}

export async function commitBatchAction(batchId: string): Promise<{ ok: true }> {
  const user = await assertUser("import");
  z.string().min(1).parse(batchId);
  await enqueueImport({ kind: "commit", batchId });
  await audit({ user, action: "IMPORT", entity: "ImportBatch", entityId: batchId, summary: "İdxal bazaya yazılmaq üçün təsdiqləndi" });
  return { ok: true };
}
