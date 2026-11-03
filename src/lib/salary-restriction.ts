/**
 * Maaş məxfiliyi — DB sorğuları. `server-only` YOXDUR: idxal worker-i (tsx) də işlədir.
 * İstifadəçi ilə bağlı sarğılar: `src/lib/auth/salary-access.ts`.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { hiddenFor, isSalaryPrivileged, lockedFor, type SalaryViewer } from "./salary-privacy";

type Db = PrismaClient | Prisma.TransactionClient;

/** Məxfi bölmələr: işarələnmiş bölmə və bütün alt bölmələri */
export async function restrictedDepartmentIds(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE rd AS (
      SELECT id FROM "Department" WHERE "salaryRestricted"
      UNION
      SELECT d.id FROM "Department" d JOIN rd ON d."parentId" = rd.id
    )
    SELECT id FROM rd`;
  return new Set(rows.map((r) => r.id));
}

/**
 * Məxfi şəxslər:
 *  - məxfi bölmədə (alt bölmələr daxil) istənilən müqaviləsi olan — azad olunmuş müqavilə də (keçmiş kadr əməkdaşının
 *    o dövrdəki maaş tarixçəsi də məxfi qalır; başqa bölməyə köçürmə ilə məxfilik götürülmür);
 *  - əl ilə işarələnmiş (Person.salaryRestricted);
 *  - istifadəçi hesabına bağlanmış (User.personId).
 */
export async function restrictedPersonIds(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE rd AS (
      SELECT id FROM "Department" WHERE "salaryRestricted"
      UNION
      SELECT d.id FROM "Department" d JOIN rd ON d."parentId" = rd.id
    )
    SELECT "personId" AS id FROM "Employment" WHERE "departmentId" IN (SELECT id FROM rd)
    UNION SELECT id FROM "Person" WHERE "salaryRestricted"
    UNION SELECT "personId" AS id FROM "User" WHERE "personId" IS NOT NULL`;
  return new Set(rows.map((r) => r.id));
}

/** Bir şəxs məxfidirmi (tək sorğu) */
export async function isPersonRestricted(db: Db, personId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    WITH RECURSIVE rd AS (
      SELECT id FROM "Department" WHERE "salaryRestricted"
      UNION
      SELECT d.id FROM "Department" d JOIN rd ON d."parentId" = rd.id
    )
    SELECT (
      EXISTS (SELECT 1 FROM "Employment" WHERE "personId" = ${personId} AND "departmentId" IN (SELECT id FROM rd))
      OR EXISTS (SELECT 1 FROM "Person" WHERE id = ${personId} AND "salaryRestricted")
      OR EXISTS (SELECT 1 FROM "User" WHERE "personId" = ${personId})
    )::int AS n`;
  return (rows[0]?.n ?? 0) > 0;
}

/** Gizlədilən şəxslər (imtiyazlı üçün boş — sorğu da edilmir) */
export async function hiddenSalaryIds(db: Db, viewer: SalaryViewer): Promise<Set<string>> {
  if (isSalaryPrivileged(viewer)) return new Set();
  return hiddenFor(viewer, await restrictedPersonIds(db));
}

/** Maaşını dəyişə bilmədiyi şəxslər */
export async function lockedSalaryIds(db: Db, viewer: SalaryViewer): Promise<Set<string>> {
  if (isSalaryPrivileged(viewer)) return new Set();
  return lockedFor(viewer, await restrictedPersonIds(db));
}

export interface SalaryAccess {
  /** Şəxs məxfidir */
  restricted: boolean;
  /** İstifadəçi görür */
  visible: boolean;
  /** İstifadəçi dəyişə bilər */
  editable: boolean;
  privileged: boolean;
  /** Şəxs istifadəçinin özüdür */
  self: boolean;
}

export async function salaryAccess(db: Db, viewer: SalaryViewer, personId: string): Promise<SalaryAccess> {
  const privileged = isSalaryPrivileged(viewer);
  const self = !!viewer.personId && viewer.personId === personId;
  const restricted = await isPersonRestricted(db, personId);
  return {
    restricted,
    privileged,
    self,
    visible: privileged || self || !restricted,
    editable: privileged || (!self && !restricted),
  };
}
