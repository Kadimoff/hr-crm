import type { DepartmentChange, Prisma, PrismaClient } from "@prisma/client";
import { changeFields, closeBlockers, dueChanges, MAX_DEPT_LEVEL, type CloseImpact, type DeptStateFields } from "./org-structure";

/*
 * Struktur dəyişikliklərinin bazaya tətbiqi. «server-only» YOX: worker (gündəlik planlaşdırılmış iş) və idxal da işlədir.
 */

type Db = Prisma.TransactionClient | PrismaClient;

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/** Bölmənin özü + bütün alt bölmələri və alt ağacın dərinliyi (yarpaq = 1) */
export async function subtreeInfo(db: Db, id: string): Promise<{ ids: Set<string>; depth: number }> {
  const rows = await db.$queryRaw<{ id: string; depth: number }[]>`
    WITH RECURSIVE t AS (
      SELECT id, 1 AS depth FROM "Department" WHERE id = ${id}
      UNION ALL
      SELECT d.id, t.depth + 1 FROM "Department" d JOIN t ON d."parentId" = t.id
    )
    SELECT id, depth::int AS depth FROM t`;
  return { ids: new Set(rows.map((r) => r.id)), depth: rows.reduce((m, r) => Math.max(m, Number(r.depth)), 1) };
}

/** Bölmənin və alt bölmələrinin səviyyəsini valideyn zəncirindən yenidən hesablayır */
export async function recomputeLevels(db: Db, id: string): Promise<void> {
  const d = await db.department.findUnique({ where: { id }, select: { parent: { select: { level: true } } } });
  if (!d) return;
  const base = d.parent ? d.parent.level + 1 : 1;
  await db.$executeRaw`
    WITH RECURSIVE t AS (
      SELECT id, ${base}::int AS lvl FROM "Department" WHERE id = ${id}
      UNION ALL
      SELECT c.id, t.lvl + 1 FROM "Department" c JOIN t ON c."parentId" = t.id
    )
    UPDATE "Department" d SET level = t.lvl, "updatedAt" = now() FROM t WHERE d.id = t.id AND d.level <> t.lvl`;
}

/** Bağlanmadan əvvəl: aktiv müqavilə, açıq alt bölmə, ştat sətri, sənəd (əsasnamə + təlimat) və rəhbər hesabları */
export async function closeImpact(db: Db, id: string, asOf: Date = todayUtc()): Promise<CloseImpact> {
  const [activeEmployments, openChildren, staffingUnits, charters, jds, headUsers] = await Promise.all([
    db.employment.count({ where: { departmentId: id, status: { not: "TERMINATED" }, person: { deletedAt: null } } }),
    db.department.count({ where: { parentId: id, OR: [{ closedOn: null }, { closedOn: { gt: asOf } }] } }),
    db.staffingUnit.count({ where: { departmentId: id } }),
    db.departmentCharter.count({ where: { departmentId: id } }),
    db.jobDescription.count({ where: { departmentId: id } }),
    db.user.count({ where: { departmentId: id, isActive: true } }),
  ]);
  return { activeEmployments, openChildren, staffingUnits, documents: charters + jds, headUsers };
}

export class StructureError extends Error {}

/**
 * Dəyişikliyi bölməyə tətbiq edir (bu gün qüvvəyə minən və ya vaxtı çatmış planlaşdırılmış):
 * RENAME — ad; MOVE — valideyn + səviyyələr (dairəvilik və maks. səviyyə yoxlanılır); CLOSE / MERGE — bağlanma tarixi
 * (aktiv müqavilə və açıq alt bölmə varsa — StructureError, dəyişiklik gözləməkdə qalır).
 */
export async function applyChange(db: Db, change: Pick<DepartmentChange, "id" | "departmentId" | "kind" | "effectiveDate" | "after">): Promise<void> {
  const after = (change.after ?? {}) as DeptStateFields;
  switch (change.kind) {
    case "RENAME":
      if (after.name) await db.department.update({ where: { id: change.departmentId }, data: { name: after.name } });
      break;
    case "MOVE": {
      const parentId = after.parentId ?? null;
      const { ids, depth } = await subtreeInfo(db, change.departmentId);
      if (parentId && ids.has(parentId)) throw new StructureError("Bölmə öz alt bölməsinə tabe edilə bilməz (dairəvi tabelik)");
      const parent = parentId ? await db.department.findUnique({ where: { id: parentId }, select: { level: true } }) : null;
      if (parentId && !parent) throw new StructureError("Yeni üst bölmə tapılmadı");
      const level = parent ? parent.level + 1 : 1;
      if (level + depth - 1 > MAX_DEPT_LEVEL) throw new StructureError(`Struktur ən çox ${MAX_DEPT_LEVEL} səviyyəli ola bilər`);
      await db.department.update({ where: { id: change.departmentId }, data: { parentId } });
      await recomputeLevels(db, change.departmentId);
      break;
    }
    case "CLOSE":
    case "MERGE": {
      const blockers = closeBlockers(await closeImpact(db, change.departmentId, change.effectiveDate));
      if (blockers.length) throw new StructureError(blockers.join("; "));
      const closedOn = after.closedOn ? new Date(`${after.closedOn}T00:00:00Z`) : change.effectiveDate;
      await db.department.update({ where: { id: change.departmentId }, data: { closedOn } });
      break;
    }
    case "CREATE":
      break;
  }
  await db.departmentChange.update({ where: { id: change.id }, data: { appliedAt: new Date() } });
}

/**
 * Vaxtı çatmış planlaşdırılmış struktur dəyişikliklərini tətbiq edir (idempotent). Worker gündəlik və struktur səhifəsi
 * açılanda çağırır. Hər dəyişiklik ayrıca tranzaksiyada; tətbiq oluna bilməyən (məs. aktiv müqavilə qalıb) gözləməkdə qalır.
 */
export async function applyDueDepartmentChanges(db: PrismaClient, today: Date = todayUtc()): Promise<{ applied: number; waiting: number }> {
  const pending = await db.departmentChange.findMany({ where: { appliedAt: null, cancelledAt: null, effectiveDate: { lte: today } } });
  let applied = 0;
  let waiting = 0;
  for (const c of dueChanges(pending, today)) {
    try {
      await db.$transaction(async (tx) => {
        // Paralel çağırışda iki dəfə tətbiq olunmasın
        const fresh = await tx.departmentChange.updateMany({ where: { id: c.id, appliedAt: null, cancelledAt: null }, data: { appliedAt: new Date() } });
        if (fresh.count === 0) return;
        const before = await tx.department.findUnique({ where: { id: c.departmentId }, select: { name: true, parentId: true, closedOn: true, code: true } });
        if (!before) return;
        await applyChange(tx, c);
        await tx.departmentChange.update({ where: { id: c.id }, data: { before: changeFields(before) as Prisma.InputJsonValue } });
        await tx.auditLog.create({
          data: {
            action: "UPDATE",
            entity: "Department",
            entityId: c.departmentId,
            username: "sistem",
            summary: `Planlaşdırılmış struktur dəyişikliyi qüvvəyə mindi: ${before.name} (${before.code}) — ${c.kind}, ${c.effectiveDate.toISOString().slice(0, 10)}`,
            changes: { changeId: c.id, before: changeFields(before), after: c.after } as unknown as Prisma.InputJsonValue,
          },
        });
        applied++;
      });
    } catch {
      waiting++;
    }
  }
  return { applied, waiting };
}
