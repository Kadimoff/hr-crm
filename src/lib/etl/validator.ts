import type { ImportStage, Prisma, PrismaClient, StagingRowStatus } from "@prisma/client";
import { departmentLevel, getSheet } from "../validation/templates";
import type { FieldIssue, RawRow, SheetKey } from "../validation/types";
import { STAGE_ORDER } from "../validation/stages";
import { validateRow } from "../validation/validate-row";
import { employmentNaturalKey, loadContext, registerInvalid, registerValid } from "./context";
import { emit } from "./progress";

export { STAGE_LABELS, STAGE_ORDER } from "../validation/stages";

const hasErrors = (issues: FieldIssue[]) => issues.some((i) => i.severity === "error");

interface RowUpdate {
  id: string;
  status: StagingRowStatus;
  errors: FieldIssue[];
}

/** Çoxlu sətrin status/xətalarını bir SQL sorğusu ilə yeniləyir */
async function bulkUpdate(db: PrismaClient, updates: RowUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const ids = updates.map((u) => u.id);
  const statuses = updates.map((u) => u.status);
  const errors = updates.map((u) => JSON.stringify(u.errors));
  await db.$executeRaw`
    UPDATE "StagingRow" AS s
    SET "status" = v.status::"StagingRowStatus", "errors" = v.errors::jsonb, "updatedAt" = now()
    FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${statuses}::text[]) AS status, unnest(${errors}::text[]) AS errors) AS v
    WHERE s.id = v.id`;
}

const PAGE = 1000;

/**
 * Bütün commit olunmamış sətirləri topoloji ardıcıllıqla yenidən yoxlayır.
 * Hər mərhələnin etibarlı sətirləri kontekstə əlavə olunur və sonrakı mərhələlər onlara istinad edə bilir.
 */
export async function validateBatch(db: PrismaClient, batchId: string): Promise<{ valid: number; invalid: number }> {
  const ctx = await loadContext(db);
  let totalValid = 0;
  let totalInvalid = 0;

  for (const stage of STAGE_ORDER) {
    const total = await db.stagingRow.count({ where: { batchId, stage, status: { not: "COMMITTED" } } });
    if (total === 0) continue;

    if (stage === "S5_EMPLOYMENTS") {
      // Ştat istifadəsi: DB-dəki aktiv müqavilələrlə başlayır; batch-da yenidən gələnlər validasiya zamanı çıxılır
      for (const { key, share } of ctx.dbEmploymentShares.values()) ctx.staffingUsage.set(key, (ctx.staffingUsage.get(key) ?? 0) + share);
    }
    const consumedDbShares = new Set<string>();

    let processed = 0;
    let valid = 0;
    let invalid = 0;

    const processRows = async (rows: { id: string; sheetKey: string; rowNumber: number; data: Prisma.JsonValue }[]) => {
      const updates: RowUpdate[] = [];
      for (const row of rows) {
        const def = getSheet(row.sheetKey as SheetKey);
        const raw = (row.data ?? {}) as RawRow;

        if (def.key === "employments") {
          const pre = def.schema.safeParse(raw);
          if (pre.success) {
            const r = pre.data as { personCode: string; positionCode: string; departmentCode: string; hireDate: Date };
            const nk = employmentNaturalKey(r.personCode, r.positionCode, r.departmentCode, r.hireDate);
            const dbShare = ctx.dbEmploymentShares.get(nk);
            if (dbShare && !consumedDbShares.has(nk)) {
              ctx.staffingUsage.set(dbShare.key, (ctx.staffingUsage.get(dbShare.key) ?? 0) - dbShare.share);
              consumedDbShares.add(nk);
            }
          }
        }

        const { parsed, issues } = validateRow(def, raw, ctx, row.rowNumber);
        const bad = parsed === null || hasErrors(issues);
        if (bad) {
          registerInvalid(ctx, def.key, raw, row.rowNumber);
          invalid++;
        } else {
          registerValid(ctx, def.key, parsed);
          valid++;
        }
        updates.push({ id: row.id, status: bad ? "INVALID" : "VALID", errors: issues });
      }
      await bulkUpdate(db, updates);
      processed += rows.length;
      await emit(batchId, { type: "stage", stage, processed, total, valid, invalid });
    };

    if (stage === "S1_DEPARTMENTS") {
      // Ağac: valideynlər övladlardan əvvəl yoxlanmalıdır → mərhələ vərəqinə (1–4) görə sıralanır
      const rows = await db.stagingRow.findMany({
        where: { batchId, stage, status: { not: "COMMITTED" } },
        select: { id: true, sheetKey: true, rowNumber: true, data: true },
      });
      rows.sort((a, b) => departmentLevel(a.sheetKey) - departmentLevel(b.sheetKey) || a.rowNumber - b.rowNumber);
      for (let i = 0; i < rows.length; i += PAGE) await processRows(rows.slice(i, i + PAGE));
    } else {
      let cursor: string | undefined;
      for (;;) {
        const rows = await db.stagingRow.findMany({
          where: { batchId, stage, status: { not: "COMMITTED" } },
          select: { id: true, sheetKey: true, rowNumber: true, data: true },
          orderBy: { id: "asc" },
          take: PAGE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (rows.length === 0) break;
        await processRows(rows);
        cursor = rows[rows.length - 1]!.id;
      }
    }
    totalValid += valid;
    totalInvalid += invalid;
  }

  await refreshFileCounters(db, batchId);
  return { valid: totalValid, invalid: totalInvalid };
}

export async function refreshFileCounters(db: PrismaClient, batchId: string): Promise<void> {
  const groups = await db.stagingRow.groupBy({ by: ["fileId", "status"], where: { batchId }, _count: { _all: true } });
  const files = await db.importFile.findMany({ where: { batchId }, select: { id: true, status: true, fileErrors: true } });
  for (const f of files) {
    const count = (s: StagingRowStatus) => groups.find((g) => g.fileId === f.id && g.status === s)?._count._all ?? 0;
    const validRows = count("VALID");
    const invalidRows = count("INVALID");
    const committedRows = count("COMMITTED");
    const totalRows = validRows + invalidRows + committedRows + count("PENDING");
    if (f.status === "FAILED") continue;
    const structural = (f.fileErrors as { severity: string }[]).some((e) => e.severity === "error");
    await db.importFile.update({
      where: { id: f.id },
      data: {
        totalRows,
        validRows,
        invalidRows,
        committedRows,
        status: invalidRows > 0 || structural ? "HAS_ERRORS" : committedRows === totalRows && totalRows > 0 ? "COMMITTED" : "VALIDATED",
      },
    });
  }
}
