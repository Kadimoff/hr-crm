import "server-only";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Verilənlər bazasının backup-ı, bərpası və təmizlənməsi (yalnız ROOT).
 * Backup — bütün cədvəllərin JSON snapshot-u (gzip), storage/backups qovluğunda saxlanılır.
 * Cədvəl siyahısı və FK sırası information_schema-dan oxunur — sxem dəyişəndə kod dəyişmir.
 */

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? "./storage/backups");
const BACKUP_NAME = /^backup-\d{8}-\d{9}(-[a-z]+)?\.json\.gz$/;

/** Backup-a düşməyən cədvəllər: miqrasiya jurnalı və sessiyalar (bərpadan sonra hamı yenidən daxil olur) */
const SKIP_BACKUP = new Set(["_prisma_migrations", "Session"]);
/** Təmizləmədə saxlanılan cədvəllər — istifadəçilər, sessiyalar, audit jurnalı */
const KEEP_ON_WIPE = new Set(["_prisma_migrations", "User", "Session", "AuditLog"]);

interface ForeignKey {
  child: string;
  parent: string;
  column: string;
  nullable: boolean;
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function schemaInfo() {
  const tables = (
    await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`
  ).map((t) => t.name);
  const fks = await prisma.$queryRaw<ForeignKey[]>`
    SELECT tc.table_name AS child, ccu.table_name AS parent, kcu.column_name AS "column", (c.is_nullable = 'YES') AS nullable
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.columns c ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = kcu.column_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`;
  return { tables, fks, order: parentsFirst(tables, fks) };
}

/** Topoloji sıra: valideyn cədvəllər əvvəl (özünə istinad nəzərə alınmır) */
function parentsFirst(tables: string[], fks: ForeignKey[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const fk of fks) if (fk.child === t && fk.parent !== t) visit(fk.parent, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  for (const t of [...tables].sort()) visit(t, new Set());
  return out;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Cədvəlləri uşaqdan valideynə doğru silir; özünə istinad edən sütunlar əvvəlcə NULL edilir (onDelete: Restrict) */
async function deleteTables(tx: Tx, tables: string[], fks: ForeignKey[]) {
  for (const t of [...tables].reverse()) {
    for (const fk of fks) if (fk.child === t && fk.parent === t && fk.nullable) await tx.$executeRawUnsafe(`UPDATE ${q(t)} SET ${q(fk.column)} = NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM ${q(t)}`);
  }
}

export interface BackupFile {
  version: 1;
  createdAt: string;
  createdBy: string;
  tables: Record<string, unknown[]>;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

/** YYYYMMDD-HHmmssSSS — millisaniyə: eyni saniyədəki avtomatik backup-lar bir-birini əvəz etməsin */
const stamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 18);

/** Bütün cədvəllərin snapshot-u → storage/backups/backup-YYYYMMDD-HHmmssSSS[-reason].json.gz */
export async function createBackup(createdBy: string, reason?: "auto"): Promise<BackupInfo & { rows: number }> {
  const { order } = await schemaInfo();
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  // Ardıcıl snapshot üçün bir tranzaksiyada (REPEATABLE READ)
  await prisma.$transaction(
    async (tx) => {
      for (const t of order) {
        if (SKIP_BACKUP.has(t)) continue;
        const [res] = await tx.$queryRawUnsafe<{ data: unknown[] | null }[]>(`SELECT json_agg(t) AS data FROM ${q(t)} t`);
        const data = res?.data ?? [];
        tables[t] = data;
        rows += data.length;
      }
    },
    { timeout: 10 * 60_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const file: BackupFile = { version: 1, createdAt: new Date().toISOString(), createdBy, tables };
  await mkdir(BACKUP_DIR, { recursive: true });
  const name = `backup-${stamp()}${reason ? `-${reason}` : ""}.json.gz`;
  const buf = gzipSync(JSON.stringify(file));
  await writeFile(path.join(BACKUP_DIR, name), buf);
  return { name, size: buf.length, createdAt: file.createdAt, rows };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const names = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out = await Promise.all(
    names
      .filter((n) => BACKUP_NAME.test(n))
      .map(async (name) => {
        const s = await stat(path.join(BACKUP_DIR, name));
        return { name, size: s.size, createdAt: s.mtime.toISOString() };
      }),
  );
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/** Yol keçidinə (../) qarşı: yalnız backup adı formatına uyğun fayllar */
export function backupPath(name: string): string | null {
  return BACKUP_NAME.test(name) ? path.join(BACKUP_DIR, name) : null;
}

/** Başqa kompüterdən gətirilmiş backup faylını yoxlayıb backup-lar siyahısına əlavə edir */
export async function importBackup(raw: Buffer): Promise<BackupInfo> {
  let file: BackupFile;
  try {
    file = JSON.parse(gunzipSync(raw).toString("utf8")) as BackupFile;
  } catch {
    throw new Error("Fayl backup deyil (.json.gz açılmadı)");
  }
  if (file.version !== 1 || typeof file.tables !== "object" || !file.tables) throw new Error("Backup faylının formatı tanınmadı");
  await mkdir(BACKUP_DIR, { recursive: true });
  const name = `backup-${stamp()}-upload.json.gz`;
  await writeFile(path.join(BACKUP_DIR, name), raw);
  return { name, size: raw.length, createdAt: new Date().toISOString() };
}

export async function readBackup(name: string): Promise<Buffer | null> {
  const p = backupPath(name);
  return p ? readFile(p).catch(() => null) : null;
}

export async function deleteBackup(name: string): Promise<boolean> {
  const p = backupPath(name);
  if (!p) return false;
  return unlink(p).then(
    () => true,
    () => false,
  );
}

/**
 * Bütün məlumatları silir — istifadəçilər və audit jurnalı saxlanılır.
 * Əvvəlcə avtomatik backup alınır; onun adı qaytarılır.
 */
export async function wipeDatabase(actor: string): Promise<{ backup: string; rows: number }> {
  const backup = await createBackup(actor, "auto");
  const { order, fks } = await schemaInfo();
  const targets = order.filter((t) => !KEEP_ON_WIPE.has(t));
  let rows = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const t of targets) rows += Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${q(t)}`))[0]!.n);
      // Şöbə rəhbərlərinin bölmə bağlantısı (bölmələr silinir)
      await tx.user.updateMany({ where: { departmentId: { not: null } }, data: { departmentId: null } });
      await deleteTables(tx, targets, fks);
    },
    { timeout: 10 * 60_000 },
  );
  return { backup: backup.name, rows };
}

/**
 * Backup-dan tam bərpa: istifadəçilər və audit jurnalı daxil bütün cədvəllər backup-dakı vəziyyətə qayıdır,
 * bütün sessiyalar bağlanır. Bərpadan əvvəl cari vəziyyətin avtomatik backup-ı alınır.
 */
export async function restoreBackup(name: string, actor: string): Promise<{ backup: string; rows: number }> {
  const raw = await readBackup(name);
  if (!raw) throw new Error("Backup faylı tapılmadı");
  const file = JSON.parse(gunzipSync(raw).toString("utf8")) as BackupFile;
  if (file.version !== 1 || typeof file.tables !== "object") throw new Error("Backup faylının formatı tanınmadı");

  const safety = await createBackup(actor, "auto");
  const { tables, order, fks } = await schemaInfo();
  const unknown = Object.keys(file.tables).filter((t) => !tables.includes(t));
  if (unknown.length) throw new Error(`Backup-da cari sxemdə olmayan cədvəllər var: ${unknown.join(", ")}`);

  let rows = 0;
  await prisma.$transaction(
    async (tx) => {
      await deleteTables(
        tx,
        order.filter((t) => t !== "_prisma_migrations"),
        fks,
      );
      // Valideyndən uşağa; json_populate_recordset tipləri (tarix, Decimal, enum, JSONB) cədvəlin özündən götürür
      for (const t of order) {
        const data = file.tables[t];
        if (!data?.length) continue;
        await tx.$executeRawUnsafe(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, JSON.stringify(data));
        rows += data.length;
      }
    },
    { timeout: 10 * 60_000 },
  );
  return { backup: safety.name, rows };
}

/** Səhifədəki xülasə üçün əsas cədvəllərin sətir sayı */
export async function tableCounts() {
  const [persons, employments, departments, positions, staffing, imports, users, audits] = await Promise.all([
    prisma.person.count(),
    prisma.employment.count(),
    prisma.department.count(),
    prisma.position.count(),
    prisma.staffingUnit.count(),
    prisma.importBatch.count(),
    prisma.user.count(),
    prisma.auditLog.count(),
  ]);
  return { persons, employments, departments, positions, staffing, imports, users, audits };
}
