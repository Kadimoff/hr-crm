"use client";

import { ArchiveRestoreIcon, DatabaseBackupIcon, DownloadIcon, HardDriveIcon, LoaderIcon, Trash2Icon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createBackupAction, deleteBackupAction, restoreBackupAction, wipeDatabaseAction, type DbActionState } from "@/actions/database";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import type { BackupInfo } from "@/lib/admin/database";
import { formatDateTime, formatNumber } from "@/lib/utils";

const COUNT_LABELS: Record<string, string> = {
  persons: "Fiziki şəxslər",
  employments: "Əmək müqavilələri",
  departments: "Struktur bölmələri",
  positions: "Vəzifələr",
  staffing: "Ştat vahidləri",
  imports: "İdxal paketləri",
  users: "İstifadəçilər",
  audits: "Audit qeydləri",
  documents: "Şəxsi iş sənədləri",
};

const size = (b: number) => (b < 1024 * 1024 ? `${formatNumber(b / 1024, 1)} KB` : `${formatNumber(b / 1024 / 1024, 1)} MB`);

/** Şifrə + (lazım olsa) təsdiq ifadəsi tələb edən dialoq */
function DangerDialog({
  trigger,
  title,
  description,
  action,
  phrase,
  hidden,
  submitLabel,
  onDone,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action: (s: DbActionState, f: FormData) => Promise<DbActionState>;
  phrase?: string;
  hidden?: Record<string, string>;
  submitLabel: string;
  onDone: (s: DbActionState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      onDone(state);
    }
  }, [state, onDone]);
  const ready = !phrase || typed.trim().toLocaleLowerCase("az") === phrase;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTyped("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <TriangleAlertIcon className="size-5" /> {title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">{description}</div>
            </DialogDescription>
          </DialogHeader>
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {phrase && (
            <FormField label={`Təsdiq üçün «${phrase}» yazın`} htmlFor="phrase" required>
              <Input id="phrase" name="phrase" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </FormField>
          )}
          <FormField label="Şifrəniz" htmlFor="password" hint="Geri dönməz əməliyyat — şifrə yenidən yoxlanılır" required>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </FormField>
          {state.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Ləğv et
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || pending}>
              {pending && <LoaderIcon className="animate-spin" />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DatabaseAdmin({ counts, backups }: { counts: Record<string, number>; backups: BackupInfo[] }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<DbActionState>) =>
    startBusy(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else toast.success(r.message);
    });

  const afterRestore = (s: DbActionState) => {
    toast.success(s.message);
    if (s.loggedOut) router.push("/login");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bazanın vəziyyəti</CardTitle>
          <CardDescription>Əsas cədvəllərdəki qeydlərin sayı</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(counts).map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-muted/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{COUNT_LABELS[k] ?? k}</div>
              <div className="text-lg font-bold tabular-nums">{formatNumber(v)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Backup-lar</CardTitle>
            <CardDescription className="mt-0.5">
              Bütün cədvəllərin (istifadəçilər və audit jurnalı daxil) snapshot-u və şəxsi iş sənədlərinin faylları — bir .zip faylında, serverdə{" "}
              <code className="font-mono">storage/backups</code> qovluğunda saxlanılır
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Başqa kompüterdən yüklənmiş backup — sonra "Bərpa et" ilə tətbiq olunur */}
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.gz,application/zip,application/gzip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                // Fayl olduğu kimi göndərilir və serverdə diskə axınla yazılır (sənədli backup GB ola bilər)
                run(async () => {
                  const res = await fetch("/api/admin/backups/upload", { method: "POST", headers: { "X-File-Name": encodeURIComponent(f.name) }, body: f });
                  const body = (await res.json().catch(() => ({}))) as DbActionState;
                  if (res.ok) router.refresh();
                  return res.ok ? { ok: true, message: body.message } : { error: body.error ?? "Yükləmə alınmadı" };
                });
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <UploadIcon /> Fayldan yüklə
            </Button>
            <Button onClick={() => run(createBackupAction)} disabled={busy}>
              {busy ? <LoaderIcon className="animate-spin" /> : <DatabaseBackupIcon />} Backup al
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {backups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <HardDriveIcon className="size-6 opacity-60" />
              Hələ backup yoxdur. Böyük dəyişikliklərdən əvvəl backup alın.
            </div>
          ) : (
            <ul className="divide-y">
              {backups.map((b) => (
                <li key={b.name} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <HardDriveIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs font-semibold">{b.name}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDateTime(b.createdAt)} · {size(b.size)} · {b.documents === null ? "yalnız baza (köhnə format)" : `baza + ${b.documents} sənəd faylı`}
                      {/-auto\.(zip|json\.gz)$/.test(b.name) && " · avtomatik (silmə/bərpadan əvvəl)"}
                      {b.name.endsWith("-deploy.zip") && " · yeni versiyanın deploy-undan əvvəl"}
                      {b.name.endsWith("-nightly.zip") && " · gecə backup-ı"}
                      {/-upload\.(zip|json\.gz)$/.test(b.name) && " · fayldan yüklənib"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download>
                        <DownloadIcon /> Yüklə
                      </a>
                    </Button>
                    <DangerDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          <ArchiveRestoreIcon /> Bərpa et
                        </Button>
                      }
                      title="Backup-dan bərpa"
                      description={
                        <>
                          <p>
                            Bütün cədvəllər <b className="font-mono">{b.name}</b> faylındakı vəziyyətə qayıdacaq — istifadəçilər və audit jurnalı da daxil olmaqla.
                          </p>
                          <p>Bərpadan əvvəl cari vəziyyətin avtomatik backup-ı alınır. Bütün sessiyalar bağlanacaq, hamı yenidən daxil olmalıdır.</p>
                        </>
                      }
                      action={restoreBackupAction}
                      hidden={{ name: b.name }}
                      submitLabel="Bərpa et"
                      onDone={afterRestore}
                    />
                    <Button variant="ghost" size="sm" className="text-danger" disabled={busy} onClick={() => run(() => deleteBackupAction(b.name))} aria-label={`${b.name} faylını sil`}>
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-danger/40">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-danger">Bütün məlumatları sil</CardTitle>
            <CardDescription className="mt-0.5 max-w-2xl">
              Fiziki şəxslər, müqavilələr, struktur, vəzifələr, ştat cədvəli, məzuniyyətlər, idxal tarixçəsi və şəxsi iş sənədləri (fayllar da) silinir. İstifadəçi hesabları və audit
              jurnalı saxlanılır. Silmədən əvvəl sənədlərlə birlikdə avtomatik backup alınır. Yalnız administrator (root) edə bilər.
            </CardDescription>
          </div>
          <DangerDialog
            trigger={
              <Button variant="destructive">
                <Trash2Icon /> Bazanı təmizlə
              </Button>
            }
            title="Bütün məlumatları sil"
            description={
              <>
                <p>
                  {formatNumber(counts.persons ?? 0)} fiziki şəxs, {formatNumber(counts.employments ?? 0)} müqavilə və {formatNumber(counts.departments ?? 0)} struktur bölməsi və{" "}
                  {formatNumber(counts.documents ?? 0)} şəxsi iş sənədi daxil olmaqla bütün kadr məlumatları silinəcək.
                </p>
                <p>Sənəd faylları ilə birlikdə avtomatik backup alınır — lazım olsa, oradan bərpa edə bilərsiniz.</p>
              </>
            }
            action={wipeDatabaseAction}
            phrase="bazanı sil"
            submitLabel="Hamısını sil"
            onDone={(s) => toast.success(s.message)}
          />
        </CardHeader>
      </Card>
    </div>
  );
}
