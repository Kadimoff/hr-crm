"use client";

import type { DocumentKind } from "@prisma/client";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  LoaderIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderOpenIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteDocumentAction, requestDocumentDeletionAction } from "@/actions/documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DELETE_CONFIRM_WORD, matchesConfirmWord } from "@/lib/confirm";
import { DOCUMENT_ACCEPT, DOCUMENT_KINDS, documentType, extensionOf, MAX_DOCUMENT_BYTES } from "@/lib/document-types";
import { cn, formatDateTime, formatIsoDate } from "@/lib/utils";

export interface DocumentRow {
  id: string;
  kind: DocumentKind;
  title: string;
  number: string | null;
  documentDate: string | null;
  fileName: string;
  extension: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
  /** Root-un qərarını gözləyən silmə sorğusu */
  pendingDeletion: { by: string | null; reason: string } | null;
}

const KINDS = Object.keys(DOCUMENT_KINDS) as DocumentKind[];

const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Fayl növünün ikonu və rəngi */
function FileBadge({ ext, className }: { ext: string; className?: string }) {
  const t = documentType(ext);
  const [Icon, tone] =
    ext === "pdf"
      ? [FileTextIcon, "bg-danger-soft text-danger"]
      : t?.label === "Şəkil" || ext.startsWith("tif")
        ? [FileImageIcon, "bg-primary/10 text-primary"]
        : t?.label === "Word"
          ? [FileTextIcon, "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"]
          : t?.label === "Excel"
            ? [FileSpreadsheetIcon, "bg-success-soft text-success"]
            : [FileIcon, "bg-muted text-muted-foreground"];
  return (
    <div className={cn("relative flex size-10 shrink-0 items-center justify-center rounded-lg", tone, className)}>
      <Icon className="size-5" />
      <span className="absolute -bottom-1 rounded bg-card px-1 text-[9px] font-bold tracking-wide uppercase shadow-sm">{ext}</span>
    </div>
  );
}

const fileUrl = (id: string, download = false) => `/api/documents/${id}${download ? "?download=1" : ""}`;

// ----------------------------------------------------------------------------
//  Şəxsi iş qovluğu
// ----------------------------------------------------------------------------

/** canEdit — yükləmək; canDelete — sorğusuz silmək (yoxdursa zibil qutusu silmə sorğusu göndərir) */
export function PersonDocuments({ personId, documents, canEdit, canDelete }: { personId: string; documents: DocumentRow[]; canEdit: boolean; canDelete: boolean }) {
  const [kind, setKind] = useState<DocumentKind | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<DocumentKind, number>;
    for (const d of documents) c[d.kind]++;
    return c;
  }, [documents]);

  const q = query.trim().toLocaleLowerCase("az");
  const shown = documents.filter(
    (d) => (kind === "ALL" || d.kind === kind) && (!q || [d.title, d.number, d.fileName].some((v) => v?.toLocaleLowerCase("az").includes(q))),
  );

  const openUpload = (files: File[]) => files.length > 0 && setUploadFiles(files);

  return (
    <Card
      className={cn("relative transition-colors", dragOver && "ring-2 ring-primary")}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDragOver(false);
        openUpload([...e.dataTransfer.files]);
      }}
    >
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <FolderOpenIcon className="size-4 text-primary" /> Şəxsi iş qovluğu
            </h3>
            <p className="text-xs text-muted-foreground">Əmrlər, skan edilmiş sənədlər, şəkillər, Word və Excel faylları · {documents.length} sənəd</p>
          </div>
          {canEdit && (
            <>
              <input
                ref={pickRef}
                type="file"
                multiple
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  openUpload([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              <Button onClick={() => pickRef.current?.click()}>
                <UploadCloudIcon /> Sənəd yüklə
              </Button>
            </>
          )}
        </div>

        {documents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ad, nömrə və ya fayl adı…" className="h-8 pl-8 text-xs" aria-label="Sənəd axtar" />
            </div>
            <KindChip active={kind === "ALL"} onClick={() => setKind("ALL")} label="Hamısı" count={documents.length} />
            {KINDS.filter((k) => counts[k] > 0).map((k) => (
              <KindChip key={k} active={kind === k} onClick={() => setKind(k)} label={DOCUMENT_KINDS[k]} count={counts[k]} />
            ))}
          </div>
        )}

        {documents.length === 0 ? (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => pickRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center text-sm text-muted-foreground transition-colors enabled:hover:border-primary/50 enabled:hover:bg-primary/5"
          >
            <UploadCloudIcon className="size-8 text-primary/60" />
            <span className="font-medium text-foreground">Şəxsi işdə hələ sənəd yoxdur</span>
            {canEdit && <span>Faylları bura sürükləyin və ya klikləyib seçin — PDF, skan, şəkil, Word, Excel (hər biri 30 MB-dək)</span>}
          </button>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Axtarışa uyğun sənəd tapılmadı</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {shown.map((d) => {
              const viewable = documentType(d.extension)?.view != null;
              return (
                <li key={d.id} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
                  <button type="button" onClick={() => setViewing(d.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <FileBadge ext={d.extension} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium group-hover:text-primary">{d.title}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {DOCUMENT_KINDS[d.kind]}
                        </Badge>
                        {d.pendingDeletion && (
                          <Badge variant="warning" className="px-1.5 py-0 text-[10px]" title={`${d.pendingDeletion.by ?? ""}: ${d.pendingDeletion.reason}`}>
                            <ClockIcon className="size-3" /> Silmə sorğusu gözləyir
                          </Badge>
                        )}
                        {d.number && <span>№ {d.number}</span>}
                        {d.documentDate && <span className="tabular-nums">{formatIsoDate(d.documentDate)}</span>}
                        <span className="truncate">
                          {d.fileName} · {formatBytes(d.size)}
                        </span>
                      </div>
                    </div>
                  </button>
                  <div className="hidden shrink-0 text-right text-[11px] text-muted-foreground md:block">
                    <div>{d.uploadedBy ?? "—"}</div>
                    <div className="tabular-nums">{formatDateTime(d.createdAt)}</div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {viewable && (
                      <Button variant="ghost" size="icon" onClick={() => setViewing(d.id)} title="Bax" aria-label={`Bax: ${d.title}`}>
                        <EyeIcon />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" asChild title="Yüklə">
                      <a href={fileUrl(d.id, true)} aria-label={`Yüklə: ${d.title}`}>
                        <DownloadIcon />
                      </a>
                    </Button>
                    {(canDelete || !d.pendingDeletion) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(d)}
                        title={canDelete ? "Sil" : "Silmə sorğusu göndər"}
                        aria-label={`${canDelete ? "Sil" : "Silmə sorğusu"}: ${d.title}`}
                        className="text-muted-foreground hover:text-danger"
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10 text-sm font-medium text-primary backdrop-blur-[1px]">
          <UploadCloudIcon className="mr-2 size-5" /> Faylları buraxın — şəxsi işə əlavə olunacaq
        </div>
      )}

      <DocumentViewer docs={shown} id={viewing} onChange={setViewing} />
      {uploadFiles && <UploadDialog personId={personId} initial={uploadFiles} onClose={() => setUploadFiles(null)} />}
      {deleting && <DeleteDocumentDialog doc={deleting} direct={canDelete} onClose={() => setDeleting(null)} />}
    </Card>
  );
}

function KindChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "text-primary-foreground/80" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

// ----------------------------------------------------------------------------
//  Baxış: PDF və şəkil olduğu kimi, Word/Excel — HTML görünüşü; ← → ilə növbəti sənəd
// ----------------------------------------------------------------------------

function DocumentViewer({ docs, id, onChange }: { docs: DocumentRow[]; id: string | null; onChange: (id: string | null) => void }) {
  const idx = docs.findIndex((d) => d.id === id);
  const doc = idx >= 0 ? docs[idx] : undefined;
  const view = doc ? documentType(doc.extension)?.view : null;
  const go = (step: number) => {
    const next = docs[idx + step];
    if (next) onChange(next.id);
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent
        className="h-[calc(100dvh-2rem)] max-w-6xl gap-3 overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          else if (e.key === "ArrowLeft") go(-1);
        }}
      >
        {doc && (
          <>
            <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-3 pr-12">
              <FileBadge ext={doc.extension} className="size-9" />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base">{doc.title}</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  {DOCUMENT_KINDS[doc.kind]}
                  {doc.number && ` · № ${doc.number}`}
                  {doc.documentDate && ` · ${formatIsoDate(doc.documentDate)}`} · {doc.fileName} · {formatBytes(doc.size)}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground tabular-nums">
                  {idx + 1} / {docs.length}
                </span>
                <Button variant="outline" size="icon" onClick={() => go(-1)} disabled={idx <= 0} aria-label="Əvvəlki sənəd">
                  <ChevronLeftIcon />
                </Button>
                <Button variant="outline" size="icon" onClick={() => go(1)} disabled={idx >= docs.length - 1} aria-label="Növbəti sənəd">
                  <ChevronRightIcon />
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={fileUrl(doc.id, true)}>
                    <DownloadIcon /> Yüklə
                  </a>
                </Button>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 bg-muted/40">
              {view === "file" && doc.extension === "pdf" && <iframe key={doc.id} src={fileUrl(doc.id)} title={doc.title} className="size-full" />}
              {view === "file" && doc.extension !== "pdf" && (
                <div className="flex size-full items-center justify-center overflow-auto p-4">
                  <img key={doc.id} src={fileUrl(doc.id)} alt={doc.title} className="max-h-full max-w-full rounded-md object-contain shadow-md" />
                </div>
              )}
              {/* Word/Excel serverdə HTML-ə çevrilir; skriptsiz sandbox */}
              {view === "html" && <iframe key={doc.id} src={`/api/documents/${doc.id}/preview`} title={doc.title} sandbox="" className="size-full bg-white" />}
              {!view && (
                <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  <FileBadge ext={doc.extension} className="size-14" />
                  <p>
                    <b className="text-foreground">.{doc.extension}</b> faylı brauzerdə açılmır — yükləyib kompüterdə açın.
                    <br />
                    Növbəti dəfə baxmaq rahat olsun deyə PDF, .docx və ya .xlsx formatında yükləmək tövsiyə olunur.
                  </p>
                  <Button asChild>
                    <a href={fileUrl(doc.id, true)}>
                      <DownloadIcon /> Faylı yüklə
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
//  Yükləmə
// ----------------------------------------------------------------------------

/** Bu gün YYYY-MM-DD (yerli vaxtla) — tarix sahəsinin defoltu */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type FileStatus = { state: "waiting" | "uploading" | "done" } | { state: "failed"; error: string };

/** Bir faylı göndərir; irəliləyiş baytla qaytarılır */
function sendFile(personId: string, file: File, fields: Record<string, string>, onProgress: (loaded: number) => void): Promise<{ error?: string }> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("files", file);
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    // fetch yükləmə irəliləyişini vermir — böyük skanlar üçün XHR
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/persons/${personId}/documents`);
    xhr.upload.onprogress = (ev) => onProgress(ev.loaded);
    xhr.onload = () => {
      let res: { saved?: number; error?: string; rejected?: { reason: string }[] } = {};
      try {
        res = JSON.parse(xhr.responseText);
      } catch {}
      resolve(xhr.status < 400 && res.saved ? {} : { error: res.rejected?.[0]?.reason ?? res.error ?? `Server xətası (${xhr.status})` });
    };
    xhr.onerror = () => resolve({ error: "Şəbəkə xətası" });
    xhr.send(form);
  });
}

function UploadDialog({ personId, initial, onClose }: { personId: string; initial: File[]; onClose: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState(initial);
  const [status, setStatus] = useState<FileStatus[]>(() => initial.map(() => ({ state: "waiting" })));
  const [kind, setKind] = useState<DocumentKind | "">("");
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const pickRef = useRef<HTMLInputElement>(null);

  const problems = files.map((f) => (!extensionOf(f.name) ? "Bu fayl növü qəbul olunmur" : f.size > MAX_DOCUMENT_BYTES ? "30 MB-dan böyükdür" : null));
  const pending = files.map((_, i) => i).filter((i) => !problems[i] && status[i]?.state !== "done");
  const single = files.length === 1 && pending.length === 1;
  const uploading = progress !== null;

  const addFiles = (more: File[]) => {
    setFiles([...files, ...more]);
    setStatus([...status, ...more.map((): FileStatus => ({ state: "waiting" }))]);
  };
  const removeFile = (i: number) => {
    setFiles(files.filter((_, j) => j !== i));
    setStatus(status.filter((_, j) => j !== i));
  };
  const setOne = (i: number, st: FileStatus) => setStatus((prev) => prev.map((p, j) => (j === i ? st : p)));

  // Fayllar ardıcıl, hər biri ayrı sorğu ilə: bir faylın xətası digərlərinə mane olmur
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending.length) return setError("Qəbul olunan fayl yoxdur");
    setError(undefined);
    const total = pending.reduce((sum, i) => sum + files[i]!.size, 0) || 1;
    let sent = 0;
    let saved = 0;
    setProgress(0);
    for (const i of pending) {
      const file = files[i]!;
      setOne(i, { state: "uploading" });
      const res = await sendFile(personId, file, { kind, title: single ? title.trim() : "", number: number.trim(), date }, (loaded) =>
        setProgress(Math.round(((sent + Math.min(loaded, file.size)) / total) * 100)),
      );
      sent += file.size;
      if (res.error) setOne(i, { state: "failed", error: res.error });
      else {
        setOne(i, { state: "done" });
        saved++;
      }
    }
    setProgress(null);
    if (saved) {
      toast.success(saved === 1 ? "Sənəd şəxsi işə əlavə edildi" : `${saved} sənəd şəxsi işə əlavə edildi`);
      router.refresh();
    }
    if (saved === pending.length) onClose();
    else setError(`${pending.length - saved} fayl yüklənmədi — səbəb faylın altında yazılıb`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !uploading && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Şəxsi işə sənəd yükləmək</DialogTitle>
            <DialogDescription>PDF (əmrlər, skanlar), şəkil (JPG, PNG), Word, Excel — hər fayl 30 MB-dək. Bir neçə fayl seçsəniz, hamısı eyni növ və tarixlə yazılır.</DialogDescription>
          </DialogHeader>

          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {files.map((f, i) => {
              const st = status[i];
              const note = problems[i] ?? (st?.state === "failed" ? st.error : null);
              return (
                <li
                  key={`${f.name}-${i}`}
                  className={cn("flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5", note && "border-danger/40 bg-danger-soft", st?.state === "done" && "border-success/40 bg-success-soft")}
                >
                  <FileBadge ext={extensionOf(f.name) ?? f.name.split(".").pop()?.toLowerCase() ?? "?"} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{f.name}</div>
                    <div className={cn("text-xs", note ? "text-danger" : "text-muted-foreground")}>{note ?? formatBytes(f.size)}</div>
                  </div>
                  {st?.state === "uploading" && <LoaderIcon className="size-4 animate-spin text-primary" />}
                  {st?.state === "done" && <CircleCheckIcon className="size-4 text-success" />}
                  {st?.state === "failed" && <CircleXIcon className="size-4 text-danger" />}
                  {!uploading && st?.state !== "done" && (
                    <button type="button" onClick={() => removeFile(i)} aria-label={`Siyahıdan çıxar: ${f.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted">
                      <XIcon className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {!uploading && (
            <>
              <input
                ref={pickRef}
                type="file"
                multiple
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => pickRef.current?.click()}>
                <UploadCloudIcon /> Daha fayl əlavə et
              </Button>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="doc-kind">Sənədin növü</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)} disabled={uploading}>
                <SelectTrigger id="doc-kind">
                  <SelectValue placeholder="Digər (seçilməsə)" />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {DOCUMENT_KINDS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="doc-title">Adı</Label>
              <Input
                id="doc-title"
                value={single ? title : ""}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!single || uploading}
                placeholder={single ? files[pending[0]!]!.name.replace(/\.[^.]+$/, "") : "Bir neçə faylda hər biri öz fayl adını alır"}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-number">Nömrəsi</Label>
              <Input id="doc-number" value={number} onChange={(e) => setNumber(e.target.value)} disabled={uploading} placeholder="məs. 125-K" maxLength={60} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-date">Tarixi</Label>
              <DateInput id="doc-date" value={date} onChange={setDate} disabled={uploading} />
            </div>
          </div>

          {uploading && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Progress value={progress} className="flex-1" />
              <span className="tabular-nums">{progress}%</span>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={uploading}>
              {status.some((st) => st.state === "done") ? "Bağla" : "Ləğv et"}
            </Button>
            <Button type="submit" disabled={uploading || !pending.length}>
              <UploadCloudIcon /> {uploading ? "Yüklənir…" : pending.length > 1 ? `${pending.length} faylı yüklə` : "Yüklə"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
//  Silmə: icazəlilər birbaşa (səbəb + "sil"), digərləri root-a sorğu (səbəb)
// ----------------------------------------------------------------------------

function DeleteDocumentDialog({ doc, direct, onClose }: { doc: DocumentRow; direct: boolean; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ok = reason.trim().length >= 5 && (!direct || matchesConfirmWord(text));
  useEffect(() => setError(undefined), [reason, text]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    start(async () => {
      const res = direct ? await deleteDocumentAction(doc.id, reason, text) : await requestDocumentDeletionAction(doc.id, reason);
      if (res.error) return setError(res.error);
      toast.success(direct ? "Sənəd silindi" : "Silmə sorğusu administratora göndərildi");
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{direct ? "Sənədi silmək" : "Silmə sorğusu göndərmək"}</DialogTitle>
            <DialogDescription>
              <b className="text-foreground">{doc.title}</b> ({doc.fileName}){" "}
              {direct
                ? "şəxsi işdən və diskdən silinəcək (backup-larda qalır). Səbəb audit jurnalına yazılır."
                : "— sənədi silmək üçün administratorun təsdiqi lazımdır. Sorğu Sorğular panelinə düşəcək, sənəd təsdiqdən sonra silinəcək."}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span>Silmə səbəbi *</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              rows={2}
              maxLength={300}
              placeholder="məs. səhv əməkdaşa yüklənib, təkrar sənəddir"
              className="min-h-16 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
            <span className="text-xs text-muted-foreground">Qısa yazın — ən azı 5 simvol</span>
          </label>
          {direct && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span>
                Təsdiq üçün <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-danger">{DELETE_CONFIRM_WORD}</code> yazın
              </span>
              <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Təsdiq sözü" />
            </label>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Ləğv et
            </Button>
            <Button type="submit" variant="destructive" disabled={!ok || pending}>
              {direct ? <Trash2Icon /> : <SendIcon />} {pending ? "Göndərilir…" : direct ? "Sil" : "Sorğu göndər"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
