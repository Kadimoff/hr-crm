"use server";

import { revalidatePath } from "next/cache";
import { createBackup, deleteBackup, restoreBackup, wipeDatabase } from "@/lib/admin/database";
import { verifyPassword } from "@/lib/auth/password";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

/** Bütün bazanın silinməsi üçün yazılmalı ifadə */
const WIPE_PHRASE = "bazanı sil";

export interface DbActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Bərpadan sonra sessiyalar bağlanır — client /login-ə yönləndirir */
  loggedOut?: boolean;
}

const fail = (e: unknown): DbActionState => ({ error: e instanceof AuthError || e instanceof Error ? e.message : "Gözlənilməz xəta" });

/** Geri dönməz əməliyyatlardan əvvəl ROOT şifrəsini yenidən yoxlayır */
async function checkPassword(actor: CurrentUser, password: FormDataEntryValue | null): Promise<string | null> {
  if (typeof password !== "string" || !password) return "Şifrənizi daxil edin";
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } });
  return user && (await verifyPassword(password, user.passwordHash)) ? null : "Şifrə yanlışdır";
}

export async function createBackupAction(): Promise<DbActionState> {
  try {
    const actor = await assertUser("database.manage");
    const b = await createBackup(actor.username);
    await audit({ user: actor, action: "EXPORT", entity: "Database", entityId: b.name, summary: `Backup alındı: ${b.name} (${b.rows} sətir)` });
    revalidatePath("/admin/database");
    return { ok: true, message: `Backup alındı: ${b.name}` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBackupAction(name: string): Promise<DbActionState> {
  try {
    const actor = await assertUser("database.manage");
    if (!(await deleteBackup(name))) return { error: "Backup faylı tapılmadı" };
    await audit({ user: actor, action: "DELETE", entity: "Backup", entityId: name, summary: `Backup faylı silindi: ${name}` });
    revalidatePath("/admin/database");
    return { ok: true, message: "Backup faylı silindi" };
  } catch (e) {
    return fail(e);
  }
}

export async function wipeDatabaseAction(_prev: DbActionState, form: FormData): Promise<DbActionState> {
  try {
    const actor = await assertUser("database.manage");
    if (String(form.get("phrase") ?? "").trim().toLocaleLowerCase("az") !== WIPE_PHRASE) return { error: `Təsdiq üçün «${WIPE_PHRASE}» yazın` };
    const pwError = await checkPassword(actor, form.get("password"));
    if (pwError) return { error: pwError };
    const r = await wipeDatabase(actor.username);
    await audit({ user: actor, action: "DELETE", entity: "Database", summary: `Bütün məlumatlar silindi (${r.rows} sətir) · əvvəlcədən backup: ${r.backup}`, changes: { backup: r.backup, rows: r.rows } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Bütün məlumatlar silindi. Əvvəlcədən backup alındı: ${r.backup}` };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreBackupAction(_prev: DbActionState, form: FormData): Promise<DbActionState> {
  try {
    const actor = await assertUser("database.manage");
    const name = String(form.get("name") ?? "");
    const pwError = await checkPassword(actor, form.get("password"));
    if (pwError) return { error: pwError };
    const r = await restoreBackup(name, actor.username);
    // İstifadəçilər də bərpa olunur — cari istifadəçi backup-da olmaya bilər, ona görə yalnız ad yazılır
    await audit({ user: null, username: actor.username, action: "RESTORE", entity: "Database", entityId: name, summary: `Backup-dan bərpa: ${name} (${r.rows} sətir) · əvvəlki vəziyyət: ${r.backup}` });
    revalidatePath("/", "layout");
    return { ok: true, loggedOut: true, message: `Bərpa olundu: ${name}. Yenidən daxil olun.` };
  } catch (e) {
    return fail(e);
  }
}
