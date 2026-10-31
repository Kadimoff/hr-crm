import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "./session";

/**
 * İstifadəçinin görə biləcəyi struktur bölmələri.
 * null — məhdudiyyət yoxdur (ROOT, HR); massiv — şöbə rəhbərinin bölməsi və bütün alt bölmələri.
 */
export async function departmentScope(user: CurrentUser): Promise<string[] | null> {
  if (user.role !== "DEPT_HEAD") return null;
  if (!user.departmentId) return [];
  return departmentSubtree(user.departmentId);
}

/** Bölmənin özü və bütün alt bölmələrinin id-ləri */
export async function departmentSubtree(rootId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Department" WHERE id = ${rootId}
      UNION ALL
      SELECT d.id FROM "Department" d JOIN tree t ON d."parentId" = t.id
    )
    SELECT id FROM tree`;
  return rows.map((r) => r.id);
}

/** Person sorğusu üçün filtr: arxivdə olmayanlar + (lazım olsa) bölmə məhdudiyyəti */
export function personScopeWhere(scope: string[] | null, opts: { archived?: boolean } = {}): Prisma.PersonWhereInput {
  return {
    deletedAt: opts.archived ? { not: null } : null,
    ...(scope ? { employments: { some: { departmentId: { in: scope }, status: { not: "TERMINATED" } } } } : {}),
  };
}

export async function canAccessPerson(user: CurrentUser, personId: string): Promise<boolean> {
  const scope = await departmentScope(user);
  if (!scope) return true;
  const n = await prisma.person.count({ where: { id: personId, ...personScopeWhere(scope) } });
  return n > 0;
}
