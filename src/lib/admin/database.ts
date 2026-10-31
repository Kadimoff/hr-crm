import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import archiver from "archiver";
import { Open } from "unzipper";
import { prisma } from "@/lib/db";
import { DOCUMENTS_DIR } from "@/lib/documents";

/**
 * Verilənlər bazasının backup-ı, bərpası və təmizlənməsi (yalnız ROOT).
 * Backup — bir .zip faylı: database.json (bütün cədvəllərin JSON snapshot-u) + documents/ (şəxsi iş sənədlərinin faylları).
 * storage/backups qovluğunda saxlanılır. Köhnə .json.gz backup-lar (yalnız baza) bərpa oluna bilir.
 * Cədvəl siyahısı və FK sırası information_schema-dan oxunur — sxem dəyişəndə kod dəyişmir.
 */

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? "./storage/backups");
const BACKUP_NAME = /^backup-\d{8}-\d{9}(-[a-z]+)?\.(zip|json\.gz)$/;
const DB_ENTRY = "database.json";
const DOCS_PREFIX = "documents/";
/** Zip-dən çıxarılan sənəd yolu: <personId>/<id>.<uzantı> — başqa heç nə (../ və s.) qəbul olunmur */
const DOC_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]+$/;

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
  const columns = new Map<string, Set<string>>();
  for (const c of await prisma.$queryRaw<{ table: string; column: string }[]>`
    SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns WHERE table_schema = current_schema()`) {
    columns.set(c.table, (columns.get(c.table) ?? new Set()).add(c.column));
  }
  return { tables, fks, columns, order: parentsFirst(tables, fks) };
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
  /** 1 — köhnə .json.gz (yalnız baza); 2 — .zip içində, sənədlərlə */
  version: 1 | 2;
  createdAt: string;
  createdBy: string;
  tables: Record<string, unknown[]>;
  documents?: { count: number; bytes: number; missing: number };
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  /** Backup-dakı sənəd faylları; null — köhnə format, sənədsiz */
  documents: number | null;
}

/** YYYYMMDD-HHmmssSSS — millisaniyə: eyni saniyədəki avtomatik backup-lar bir-birini əvəz etməsin */
const stamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 18);

/**
 * Backup-ın səbəbi faylın adına yazılır: auto — silmə/bərpadan əvvəl, deploy — yeni versiyadan əvvəl, nightly — gecə.
 * Əl ilə alınanlarda səbəb yoxdur.
 */
export type BackupReason = "auto" | "deploy" | "nightly";

/** Avtomatik backup-ların neçəsi saxlanılır (köhnələr silinir); əl ilə alınanlara toxunulmur */
const KEEP: Record<"deploy" | "nightly", number> = { deploy: 10, nightly: 14 };

/** Bütün cədvəllər + sənəd faylları → storage/backups/backup-YYYYMMDD-HHmmssSSS[-reason].zip */
export async function createBackup(createdBy: string, reason?: BackupReason): Promise<BackupInfo & { rows: number }> {
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

  // Snapshot-dakı sənədlərin faylları — bazanın vəziyyətinə uyğun
  const docs: { rel: string; size: number }[] = [];
  const referenced = ((tables.PersonDocument ?? []) as { storagePath: string }[]).map((d) => d.storagePath);
  for (const rel of referenced) {
    const s = await stat(path.join(DOCUMENTS_DIR, rel)).catch(() => null);
    if (s?.isFile()) docs.push({ rel, size: s.size });
  }
  const file: BackupFile = {
    version: 2,
    createdAt: new Date().toISOString(),
    createdBy,
    tables,
    documents: { count: docs.length, bytes: docs.reduce((s, d) => s + d.size, 0), missing: referenced.length - docs.length },
  };

  await mkdir(BACKUP_DIR, { recursive: true });
  const name = `backup-${stamp()}${reason ? `-${reason}` : ""}.zip`;
  const target = path.join(BACKUP_DIR, name);
  const tmp = `${target}.tmp`;
  try {
    // Fayllar axınla yazılır — yaddaşa yığılmır; PDF/şəkil artıq sıxılıb, olduğu kimi saxlanılır
    const archive = archiver("zip", { zlib: { level: 6 } });
    const out = createWriteStream(tmp);
    const written = new Promise<void>((resolve, reject) => {
      out.on("close", resolve);
      out.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(out);
    archive.append(JSON.stringify(file), { name: DB_ENTRY });
    for (const d of docs) archive.file(path.join(DOCUMENTS_DIR, d.rel), { name: `${DOCS_PREFIX}${d.rel}`, store: true });
    await archive.finalize();
    await written;
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return { name, size: (await stat(target)).size, createdAt: file.createdAt, rows, documents: docs.length };
}

type ZipDirectory = Awaited<ReturnType<typeof Open.file>>;

/** Backup faylını oxuyub yoxlayır; .zip üçün sənədləri çıxarmaq üçün kataloq da qaytarılır */
async function readBackupFile(p: string, format: "zip" | "json.gz" = p.endsWith(".zip") ? "zip" : "json.gz"): Promise<{ file: BackupFile; zip: ZipDirectory | null }> {
  let file: BackupFile;
  let zip: ZipDirectory | null = null;
  try {
    if (format === "zip") {
      zip = await Open.file(p);
      const entry = zip.files.find((f) => f.path === DB_ENTRY);
      if (!entry) throw new Error();
      file = JSON.parse((await entry.buffer()).toString("utf8")) as BackupFile;
    } else {
      file = JSON.parse(gunzipSync(await readFile(p)).toString("utf8")) as BackupFile;
    }
  } catch {
    throw new Error("Fayl backup deyil və ya zədələnib");
  }
  if (![1, 2].includes(file.version) || typeof file.tables !== "object" || !file.tables) throw new Error("Backup faylının formatı tanınmadı");
  return { file, zip };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const names = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out = await Promise.all(
    names
      .filter((n) => BACKUP_NAME.test(n))
      .map(async (name) => {
        const p = path.join(BACKUP_DIR, name);
        const s = await stat(p);
        // Zip-in yalnız mərkəzi kataloqu oxunur — böyük faylda da sürətlidir
        const documents = name.endsWith(".zip") ? await Open.file(p).then((z) => z.files.filter((f) => f.type === "File" && f.path.startsWith(DOCS_PREFIX)).length, () => 0) : null;
        return { name, size: s.size, createdAt: s.mtime.toISOString(), documents };
      }),
  );
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/** Deploy və gecə backup-larının ən yeniləri saxlanılır; silinənlərin adları qaytarılır */
export async function pruneBackups(reason: keyof typeof KEEP): Promise<string[]> {
  const old = (await listBackups()).filter((b) => b.name.endsWith(`-${reason}.zip`)).slice(KEEP[reason]);
  for (const b of old) await unlink(path.join(BACKUP_DIR, b.name)).catch(() => undefined);
  return old.map((b) => b.name);
}

/** Yol keçidinə (../) qarşı: yalnız backup adı formatına uyğun fayllar */
export function backupPath(name: string): string | null {
  return BACKUP_NAME.test(name) ? path.join(BACKUP_DIR, name) : null;
}

/** Endirmə üçün axın (backup GB ölçülü ola bilər) */
export async function openBackupStream(name: string) {
  const p = backupPath(name);
  const s = p ? await stat(p).catch(() => null) : null;
  return p && s?.isFile() ? { stream: createReadStream(p), size: s.size } : null;
}

/**
 * Başqa kompüterdən gətirilmiş backup (diskə yazılmış müvəqqəti fayl) yoxlanılır və siyahıya əlavə olunur.
 * Yoxlamadan keçməsə müvəqqəti fayl silinir.
 */
export async function importBackup(tmpPath: string, ext: "zip" | "json.gz"): Promise<BackupInfo> {
  try {
    const { file } = await readBackupFile(tmpPath, ext);
    const name = `backup-${stamp()}-upload.${ext}`;
    await rename(tmpPath, path.join(BACKUP_DIR, name));
    const s = await stat(path.join(BACKUP_DIR, name));
    return { name, size: s.size, createdAt: new Date().toISOString(), documents: ext === "zip" ? (file.documents?.count ?? 0) : null };
  } catch (e) {
    await rm(tmpPath, { force: true });
    throw e;
  }
}

/** Yüklənən backup-ın müvəqqəti faylı (backups qovluğunda, siyahıya düşmür) */
export async function uploadTempPath(): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });
  return path.join(BACKUP_DIR, `.upload-${stamp()}.tmp`);
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
 * Bütün məlumatları silir — istifadəçilər və audit jurnalı saxlanılır; şəxsi iş faylları da silinir.
 * Əvvəlcə avtomatik backup (sənədlərlə) alınır; onun adı qaytarılır.
 */
export async function wipeDatabase(actor: string): Promise<{ backup: string; rows: number; documents: number }> {
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
  // Fayllar backup-dadır — bazadakı qeydlərlə birlikdə diskdən də silinir
  await rm(DOCUMENTS_DIR, { recursive: true, force: true });
  return { backup: backup.name, rows, documents: backup.documents ?? 0 };
}

/** Zip-dəki sənədləri DOCUMENTS_DIR-in yanında müvəqqəti qovluğa çıxarır */
async function extractDocuments(zip: ZipDirectory): Promise<string> {
  const staging = `${DOCUMENTS_DIR}.restore-${stamp()}`;
  try {
    await mkdir(staging, { recursive: true });
    for (const f of zip.files) {
      if (f.type !== "File" || !f.path.startsWith(DOCS_PREFIX)) continue;
      const rel = f.path.slice(DOCS_PREFIX.length);
      if (!DOC_PATH.test(rel)) throw new Error(`Backup-da icazəsiz fayl yolu: ${f.path}`);
      await mkdir(path.join(staging, path.dirname(rel)), { recursive: true });
      await pipeline(f.stream(), createWriteStream(path.join(staging, rel)));
    }
    return staging;
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
}

/** Bərpa olunmuş sənəd qovluğunu cari ilə əvəz edir */
async function swapDocumentsDir(staging: string) {
  const old = `${DOCUMENTS_DIR}.old-${stamp()}`;
  await rename(DOCUMENTS_DIR, old).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
  await rename(staging, DOCUMENTS_DIR);
  await rm(old, { recursive: true, force: true });
}

/**
 * Backup-dan tam bərpa: istifadəçilər və audit jurnalı daxil bütün cədvəllər backup-dakı vəziyyətə qayıdır,
 * .zip-dən bərpada şəxsi iş faylları da; bütün sessiyalar bağlanır. Bərpadan əvvəl cari vəziyyətin avtomatik backup-ı alınır.
 */
export async function restoreBackup(name: string, actor: string): Promise<{ backup: string; rows: number; documents: number | null }> {
  const p = backupPath(name);
  if (!p || !(await stat(p).catch(() => null))) throw new Error("Backup faylı tapılmadı");
  const { file, zip } = await readBackupFile(p);

  const safety = await createBackup(actor, "auto");
  const { tables, columns, order, fks } = await schemaInfo();
  const unknown = Object.keys(file.tables).filter((t) => !tables.includes(t));
  if (unknown.length) throw new Error(`Backup-da cari sxemdə olmayan cədvəllər var: ${unknown.join(", ")}`);

  // Sənədlər əvvəlcə ayrıca qovluğa çıxarılır — baza bərpası alınmasa cari fayllara toxunulmur
  const staging = zip ? await extractDocuments(zip) : null;
  let rows = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        await deleteTables(
          tx,
          order.filter((t) => t !== "_prisma_migrations"),
          fks,
        );
        // Valideyndən uşağa; json_populate_recordset tipləri (tarix, Decimal, enum, JSONB) cədvəlin özündən götürür.
        // Sütunlar açıq sadalanır: köhnə backup-da olmayan yeni sütunlar defolt dəyərini alır
        for (const t of order) {
          const data = file.tables[t];
          if (!data?.length) continue;
          const cols = Object.keys(data[0] as object)
            .filter((c) => columns.get(t)?.has(c))
            .map(q)
            .join(", ");
          await tx.$executeRawUnsafe(`INSERT INTO ${q(t)} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, JSON.stringify(data));
          rows += data.length;
        }
      },
      { timeout: 10 * 60_000 },
    );
  } catch (e) {
    if (staging) await rm(staging, { recursive: true, force: true });
    throw e;
  }
  if (staging) await swapDocumentsDir(staging);
  return { backup: safety.name, rows, documents: zip ? (file.documents?.count ?? 0) : null };
}

/** Səhifədəki xülasə üçün əsas cədvəllərin sətir sayı */
export async function tableCounts() {
  const [persons, employments, departments, positions, staffing, imports, users, audits, documents] = await Promise.all([
    prisma.person.count(),
    prisma.employment.count(),
    prisma.department.count(),
    prisma.position.count(),
    prisma.staffingUnit.count(),
    prisma.importBatch.count(),
    prisma.user.count(),
    prisma.auditLog.count(),
    prisma.personDocument.count(),
  ]);
  return { persons, employments, departments, positions, staffing, imports, users, audits, documents };
}
