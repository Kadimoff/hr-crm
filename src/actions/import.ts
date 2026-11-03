"use server";

import type { Prisma, StagingRowStatus } from "@prisma/client";
import { z } from "zod";
import { hiddenSalaryPersonIds } from "@/lib/auth/salary-access";
import { assertUser, type CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enqueueImport } from "@/lib/queue";
import { isSalaryPrivileged, maskStagingRow, STAGING_SALARY_FIELDS } from "@/lib/salary-privacy";
import { restrictedDepartmentIds } from "@/lib/salary-restriction";
import { SHEETS } from "@/lib/validation/templates";
import { SALARY_SKIPPED, type FieldIssue, type RawRow, type SheetKey } from "@/lib/validation/types";

const sheetKeySchema = z.enum(Object.keys(SHEETS) as [SheetKey, ...SheetKey[]]);

export interface StagingRowDto {
  id: string;
  rowNumber: number;
  status: StagingRowStatus;
  data: RawRow;
  errors: FieldIssue[];
  /** Maaş məxfiliyi: gizlədilmiş sahələr (dəyər göndərilməyib; redaktədə dəyişmir) */
  masked?: string[];
}

/**
 * İdxal sətirlərində maaş sahələrini kimdən gizlətməli: məxfi şəxsin okladı (employments) və məxfi bölmənin ştat
 * maaşları (staffing). Qaytarır: sətir → gizlədiləcək sahələr (boş — heç nə).
 */
async function stagingSalaryMasker(user: CurrentUser, sheetKey: SheetKey, rows: { data: RawRow }[]): Promise<(data: RawRow) => readonly string[]> {
  const fields = STAGING_SALARY_FIELDS[sheetKey];
  if (!fields || isSalaryPrivileged(user)) return () => [];
  const [hidden, depts] = await Promise.all([hiddenSalaryPersonIds(user), restrictedDepartmentIds(prisma)]);
  const personCodes = [...new Set(rows.map((r) => (r.data.personCode ?? "").trim()).filter(Boolean))];
  const deptCodes = [...new Set(rows.map((r) => (r.data.departmentCode ?? "").trim()).filter(Boolean))];
  const [persons, departments] = await Promise.all([
    personCodes.length ? prisma.person.findMany({ where: { code: { in: personCodes } }, select: { id: true, code: true } }) : [],
    deptCodes.length ? prisma.department.findMany({ where: { code: { in: deptCodes } }, select: { id: true, code: true } }) : [],
  ]);
  const personId = new Map(persons.map((p) => [p.code, p.id]));
  const deptId = new Map(departments.map((d) => [d.code, d.id]));
  return (data) => {
    const pid = personId.get((data.personCode ?? "").trim());
    const did = deptId.get((data.departmentCode ?? "").trim());
    const own = !!pid && pid === user.personId;
    const masked = (pid && hidden.has(pid)) || (!own && !!did && depts.has(did));
    return masked ? fields : [];
  };
}

const listSchema = z.object({
  batchId: z.string().min(1),
  sheetKey: sheetKeySchema,
  onlyProblems: z.boolean().default(true),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(10).max(2000).default(500),
});

export async function listStagingRows(input: z.input<typeof listSchema>): Promise<{ rows: StagingRowDto[]; total: number }> {
  const user = await assertUser("import");
  const { batchId, sheetKey, onlyProblems, page, pageSize } = listSchema.parse(input);
  const where: Prisma.StagingRowWhereInput = {
    batchId,
    sheetKey,
    ...(onlyProblems
      ? {
          OR: [
            { status: "INVALID" },
            { status: "VALID", NOT: { errors: { equals: [] } } },
            // Yazılıb, amma maaş sahəsi atlanıb (məxfi) — izah görünsün
            { status: "COMMITTED", errors: { array_contains: [{ code: SALARY_SKIPPED }] } },
          ],
        }
      : {}),
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
  const typed = rows.map((r) => ({ ...r, data: r.data as RawRow, errors: r.errors as unknown as FieldIssue[] }));
  // Maaş məxfiliyi: başqasının (və ya öz) idxalında məxfi şəxsin / bölmənin maaş xanaları göndərilmir
  const maskOf = await stagingSalaryMasker(user, sheetKey, typed);
  return {
    rows: typed.map((r) => {
      const fields = maskOf(r.data);
      return fields.length ? (maskStagingRow(r, fields) as StagingRowDto) : r;
    }),
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
  const { batchId, edits: rawEdits, commit } = editsSchema.parse(input);
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } });
  if (batch.status === "VALIDATING" || batch.status === "COMMITTING") throw new Error("Batch hazırda emal olunur — bir az gözləyin");

  // Maaş məxfiliyi: gizlədilmiş xanalar müştəridən boş gəlir — mövcud dəyər saxlanılır (boş göndəriş onu silmir/dəyişmir)
  const existing = await prisma.stagingRow.findMany({ where: { batchId, id: { in: rawEdits.map((e) => e.id) } }, select: { id: true, sheetKey: true, data: true } });
  const byId = new Map(existing.map((r) => [r.id, { sheetKey: r.sheetKey as SheetKey, data: r.data as RawRow }]));
  const maskers = new Map<SheetKey, (d: RawRow) => readonly string[]>();
  for (const key of new Set(existing.map((r) => r.sheetKey as SheetKey)))
    maskers.set(key, await stagingSalaryMasker(user, key, existing.filter((r) => r.sheetKey === key).map((r) => ({ data: r.data as RawRow }))));
  const edits = rawEdits.map((e) => {
    const old = byId.get(e.id);
    if (!old) return e;
    const fields = maskers.get(old.sheetKey)?.(old.data) ?? [];
    if (!fields.length) return e;
    const data = { ...e.data };
    for (const f of fields) {
      if (old.data[f] === undefined) delete data[f];
      else data[f] = old.data[f]!;
    }
    return { ...e, data };
  });

  await prisma.$transaction(
    edits.map((e) =>
      prisma.stagingRow.update({
        // COMMITTED sətirlər dəyişdirilə bilməz
        where: { id: e.id, batchId, status: { not: "COMMITTED" } },
        data: { data: e.data, status: "PENDING", errors: [] },
      }),
    ),
  );
  await enqueueImport({ kind: commit ? "revalidate-commit" : "validate", batchId, actorId: user.id });
  await audit({ user, action: "UPDATE", entity: "ImportBatch", entityId: batchId, summary: `İdxal xətaları düzəldildi: ${edits.length} sətir${commit ? ", bazaya yazılır" : ""}` });
  return { ok: true, updated: edits.length };
}

export async function commitBatchAction(batchId: string): Promise<{ ok: true }> {
  const user = await assertUser("import");
  z.string().min(1).parse(batchId);
  await enqueueImport({ kind: "commit", batchId, actorId: user.id });
  await audit({ user, action: "IMPORT", entity: "ImportBatch", entityId: batchId, summary: "İdxal bazaya yazılmaq üçün təsdiqləndi" });
  return { ok: true };
}
