"use client";

import type { ImportStage } from "@prisma/client";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleIcon,
  DatabaseIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  PlusIcon,
  RadioIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { commitBatchAction } from "@/actions/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/validation/stages";
import { detectTemplateByName, getSheet, TEMPLATES } from "@/lib/validation/templates";
import type { SheetKey, TemplateKey } from "@/lib/validation/types";
import { ErrorGrid } from "./error-grid";
import { ImportStatusBadge } from "./status-badge";
import { useBatch } from "./use-batch";

interface PendingFile {
  file: File;
  templateKey: TemplateKey | null;
}

/** Mərhələ → onu təmin edən şablonlar */
const STAGE_SOURCES: Record<ImportStage, TemplateKey[]> = STAGE_ORDER.reduce(
  (acc, stage) => {
    acc[stage] = (Object.values(TEMPLATES) as (typeof TEMPLATES)[TemplateKey][])
      .filter((t) => t.sheets.some((s) => getSheet(s).stage === stage))
      .map((t) => t.key);
    return acc;
  },
  {} as Record<ImportStage, TemplateKey[]>,
);

const STEPS = ["Fayllar", "Yoxlama", "Düzəliş", "Nəticə"] as const;

export function UploadWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const batchId = params.get("batch");
  const batch = useBatch(batchId);
  const { snapshot } = batch;

  const status = snapshot?.status;
  const step = !batchId ? 0 : status === "COMPLETED" ? 3 : status === "NEEDS_REVIEW" || status === "READY" ? 2 : 1;

  const reset = () => router.push("/import");

  return (
    <div className="flex flex-col gap-6">
      <Stepper step={step} />
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {step === 0 && <SelectStep onUploaded={(id) => router.push(`/import?batch=${id}`)} />}
          {step >= 1 && snapshot && (
            <div className="flex flex-col gap-4">
              <BatchHeader batch={batch} onReset={reset} />
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-w-0 flex-col gap-4">
                  {step === 1 && <PipelineProgress batch={batch} />}
                  {step === 2 && <ReviewStep batch={batch} />}
                  {step === 3 && <DoneStep batch={batch} onReset={reset} />}
                </div>
                <aside className="flex flex-col gap-4">
                  <FilesCard snapshot={snapshot} />
                  <LiveLog batch={batch} />
                </aside>
              </div>
            </div>
          )}
          {step >= 1 && !snapshot && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Yüklənir…
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------------------

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
              i < step && "border-success bg-success text-white",
              i === step && "border-primary bg-primary text-primary-foreground",
              i > step && "text-muted-foreground",
            )}
          >
            {i < step ? <CheckCircle2Icon className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("hidden sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------------------
//  1. Fayl seçimi
// ----------------------------------------------------------------------------

function SelectStep({ onUploaded }: { onUploaded: (batchId: string) => void }) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = [...list].filter((f) => f.name.toLowerCase().endsWith(".xlsx"));
    const skipped = [...list].length - incoming.length;
    if (skipped > 0) toast.warning(`${skipped} fayl ötürüldü — yalnız .xlsx qəbul olunur`);
    setFiles((prev) => {
      const byName = new Map(prev.map((p) => [p.file.name, p]));
      for (const f of incoming) byName.set(f.name, { file: f, templateKey: detectTemplateByName(f.name) });
      return [...byName.values()].sort((a, b) => (TEMPLATES[a.templateKey!]?.number ?? 99) - (TEMPLATES[b.templateKey!]?.number ?? 99));
    });
  }, []);

  const covered = useMemo(() => new Set(files.map((f) => f.templateKey).filter(Boolean) as TemplateKey[]), [files]);
  const unresolved = files.filter((f) => !f.templateKey).length;
  const duplicates = files.length - new Set(files.map((f) => f.templateKey)).size;

  const upload = () => {
    const form = new FormData();
    for (const f of files) {
      form.append("files", f.file);
      if (f.templateKey) form.append(`template:${f.file.name}`, f.templateKey);
    }
    // fetch yükləmə irəliləyişini vermir — XHR istifadə edirik
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && setUploadPct(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setUploadPct(null);
      const body = JSON.parse(xhr.responseText || "{}") as { batchId?: string; error?: string; rejected?: { name: string; reason: string }[] };
      for (const r of body.rejected ?? []) toast.error(r.name, { description: r.reason });
      if (xhr.status >= 200 && xhr.status < 300 && body.batchId) onUploaded(body.batchId);
      else toast.error(body.error ?? "Yükləmə uğursuz oldu");
    };
    xhr.onerror = () => {
      setUploadPct(null);
      toast.error("Şəbəkə xətası");
    };
    setUploadPct(0);
    xhr.send(form);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardContent className="p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              dragging ? "scale-[1.01] border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/50",
            )}
          >
            <motion.div animate={dragging ? { y: -4, scale: 1.08 } : { y: 0, scale: 1 }} className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UploadCloudIcon className="size-6" />
            </motion.div>
            <div>
              <div className="font-medium">Excel fayllarını bura sürükləyin</div>
              <div className="mt-1 text-sm text-muted-foreground">və ya seçmək üçün klikləyin · .xlsx · hər biri 50 MB-adək</div>
            </div>
            <input ref={inputRef} type="file" accept=".xlsx" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>

          {files.length > 0 && (
            <ul className="mt-4 divide-y rounded-lg border">
              <AnimatePresence initial={false}>
                {files.map((f) => (
                  <motion.li
                    key={f.file.name}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <FileSpreadsheetIcon className="size-4 shrink-0 text-success" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{f.file.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{(f.file.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <select
                      value={f.templateKey ?? ""}
                      onChange={(e) => {
                        const key = (e.target.value || null) as TemplateKey | null;
                        setFiles((prev) => prev.map((p) => (p.file === f.file ? { ...p, templateKey: key } : p)));
                      }}
                      className={cn(
                        "h-8 max-w-[220px] rounded-md border bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                        !f.templateKey && "border-danger text-danger",
                      )}
                      aria-label="Şablon"
                    >
                      <option value="">Şablonu seçin…</option>
                      {Object.values(TEMPLATES).map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.number}. {t.title}
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Sil" onClick={() => setFiles((prev) => prev.filter((p) => p !== f))}>
                      <XIcon />
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}

          {uploadPct !== null && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Yüklənir…</span>
                <span className="tabular-nums">{uploadPct}%</span>
              </div>
              <Progress value={uploadPct} />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {unresolved > 0 && <span className="text-danger">{unresolved} faylın şablonu təyin edilməyib. </span>}
              {duplicates > 0 && <span className="text-warning">Eyni şablon üçün bir neçə fayl seçilib. </span>}
              {files.length > 0 && `${covered.size} / 10 şablon`}
            </div>
            <div className="flex gap-2">
              {files.length > 0 && (
                <Button variant="outline" onClick={() => inputRef.current?.click()}>
                  <PlusIcon /> Əlavə et
                </Button>
              )}
              <Button onClick={upload} disabled={files.length === 0 || unresolved > 0 || uploadPct !== null}>
                {uploadPct !== null ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
                Yüklə və yoxla
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topoloji icra ardıcıllığı</CardTitle>
          <CardDescription>Hər mərhələ yalnız əvvəlkilərin etibarlı məlumatlarına istinad edə bilər</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative flex flex-col gap-3 border-l pl-5">
            {STAGE_ORDER.map((stage, i) => {
              const sources = STAGE_SOURCES[stage];
              const has = sources.some((s) => covered.has(s));
              return (
                <li key={stage} className="relative">
                  <span
                    className={cn(
                      "absolute top-0.5 -left-[27px] flex size-3.5 items-center justify-center rounded-full border-2 bg-card",
                      has ? "border-success" : "border-border",
                    )}
                  >
                    {has && <span className="size-1.5 rounded-full bg-success" />}
                  </span>
                  <div className="text-sm font-medium">
                    {i + 1}. {STAGE_LABELS[stage]}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {sources.map((s) => (
                      <Badge key={s} variant={covered.has(s) ? "success" : "outline"} className="font-mono text-[10px]">
                        {TEMPLATES[s].number}
                      </Badge>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
//  Ortaq bloklar
// ----------------------------------------------------------------------------

type Batch = ReturnType<typeof useBatch>;

function BatchHeader({ batch, onReset }: { batch: Batch; onReset: () => void }) {
  const s = batch.snapshot!;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ImportStatusBadge status={s.status} />
      <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
      <span className={cn("flex items-center gap-1 text-xs", batch.connected ? "text-success" : "text-muted-foreground")}>
        <RadioIcon className={cn("size-3", batch.connected && "animate-pulse")} />
        {batch.connected ? "Canlı" : "Bağlantı yoxdur"}
      </span>
      <Button variant="outline" size="sm" className="ml-auto" onClick={onReset}>
        <PlusIcon /> Yeni idxal
      </Button>
    </div>
  );
}

function FilesCard({ snapshot }: { snapshot: NonNullable<Batch["snapshot"]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fayllar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {snapshot.files.map((f) => {
          const done = f.totalRows ? ((f.validRows + f.committedRows) / f.totalRows) * 100 : 0;
          return (
            <div key={f.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px]">{f.templateNumber}</span>
                <span className="truncate">{f.fileName}</span>
              </div>
              <Progress value={done} indicatorClassName={f.invalidRows ? "bg-warning" : "bg-success"} />
              <div className="flex gap-3 text-[11px] text-muted-foreground tabular-nums">
                <span>{f.totalRows} sətir</span>
                {f.committedRows > 0 && <span className="text-success">{f.committedRows} yazıldı</span>}
                {f.invalidRows > 0 && <span className="text-danger">{f.invalidRows} xətalı</span>}
              </div>
              {f.fileErrors.map((e, i) => (
                <div key={i} className={cn("flex gap-1.5 text-[11px]", e.severity === "error" ? "text-danger" : "text-warning")}>
                  {e.severity === "error" ? <AlertCircleIcon className="mt-px size-3 shrink-0" /> : <TriangleAlertIcon className="mt-px size-3 shrink-0" />}
                  <span>
                    <b>{e.sheet}:</b> {e.message}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function LiveLog({ batch }: { batch: Batch }) {
  if (batch.log.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hadisələr</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex max-h-64 flex-col-reverse gap-1 overflow-y-auto font-mono text-[11px]">
          {[...batch.log].reverse().map((l, i) => (
            <li
              key={`${l.at}-${i}`}
              className={cn(
                l.tone === "error" && "text-danger",
                l.tone === "warning" && "text-warning",
                l.tone === "success" && "text-success",
                l.tone === "info" && "text-muted-foreground",
              )}
            >
              <span className="opacity-60">{new Date(l.at).toLocaleTimeString("az-AZ")}</span> {l.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
//  2. Yoxlama / yazılma irəliləyişi
// ----------------------------------------------------------------------------

function PipelineProgress({ batch }: { batch: Batch }) {
  const s = batch.snapshot!;
  const committing = batch.phase === "commit" || s.status === "COMMITTING";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{committing ? "Bazaya yazılır" : "3 səviyyəli yoxlama"}</CardTitle>
        <CardDescription>Sintaktik → Semantik → İstinad · mərhələlər topoloji ardıcıllıqla icra olunur</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {STAGE_ORDER.map((stage, i) => {
          const counts = s.stages.find((x) => x.stage === stage)!.counts;
          const totalRows = counts.PENDING + counts.VALID + counts.INVALID + counts.COMMITTED;
          if (totalRows === 0) return null;
          const live = batch.stageProgress[stage];
          const commit = batch.commitProgress[stage];
          const pct = committing
            ? commit
              ? (commit.committed / Math.max(1, commit.total)) * 100
              : 0
            : live
              ? (live.processed / Math.max(1, live.total)) * 100
              : counts.PENDING === 0
                ? 100
                : 0;
          const running = pct > 0 && pct < 100;
          return (
            <div key={stage}>
              <div className="mb-1.5 flex items-center gap-2 text-sm">
                {pct >= 100 ? (
                  <CheckCircle2Icon className="size-4 text-success" />
                ) : running ? (
                  <Loader2Icon className="size-4 animate-spin text-primary" />
                ) : (
                  <CircleIcon className="size-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {i + 1}. {STAGE_LABELS[stage]}
                </span>
                <span className="ml-auto flex gap-2 text-xs tabular-nums">
                  <span className="text-success">{live?.valid ?? counts.VALID + counts.COMMITTED}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className={(live?.invalid ?? counts.INVALID) > 0 ? "text-danger" : "text-muted-foreground"}>{live?.invalid ?? counts.INVALID}</span>
                </span>
              </div>
              <Progress value={pct} indicatorClassName={(live?.invalid ?? counts.INVALID) > 0 ? "bg-warning" : undefined} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
//  3. Düzəliş
// ----------------------------------------------------------------------------

function ReviewStep({ batch }: { batch: Batch }) {
  const s = batch.snapshot!;
  const problemSheets = s.sheets.filter((x) => x.counts.INVALID > 0);
  const firstWithErrors = problemSheets[0];
  const [sheet, setSheet] = useState<SheetKey | undefined>(firstWithErrors?.sheetKey);
  const [committing, startCommit] = useTransition();
  const current = sheet && problemSheets.some((x) => x.sheetKey === sheet) ? sheet : firstWithErrors?.sheetKey;

  const valid = s.sheets.reduce((n, x) => n + x.counts.VALID, 0);
  const invalid = s.sheets.reduce((n, x) => n + x.counts.INVALID, 0);
  const busy = s.status === "VALIDATING" || s.status === "COMMITTING";

  const commitValid = () =>
    startCommit(async () => {
      await commitBatchAction(s.id);
      toast.success("Yazılma növbəyə qoyuldu", { description: `${valid} etibarlı sətir topoloji ardıcıllıqla yazılacaq` });
    });

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2Icon className="size-5" />
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">{valid}</div>
              <div className="text-xs text-muted-foreground">etibarlı sətir</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn("flex size-10 items-center justify-center rounded-full", invalid ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground")}>
              <AlertCircleIcon className="size-5" />
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">{invalid}</div>
              <div className="text-xs text-muted-foreground">düzəliş tələb edir</div>
            </div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <Button variant={invalid ? "outline" : "success"} onClick={commitValid} disabled={busy || committing || valid === 0}>
              {committing ? <Loader2Icon className="animate-spin" /> : <DatabaseIcon />}
              {invalid ? "Etibarlı sətirləri yaz" : "Bazaya yaz"}
            </Button>
            {invalid > 0 && <span className="text-[11px] text-muted-foreground">Xətalı sətirlər qalır və sonra düzəldilə bilər</span>}
          </div>
        </CardContent>
      </Card>

      {invalid > 0 && current && (
        <Card>
          <CardHeader>
            <CardTitle>Brauzerdə düzəliş</CardTitle>
            <CardDescription>Xanaları birbaşa redaktə edin, sonra “Yenidən yoxla və yaz” düyməsini basın</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Tabs value={current} onValueChange={(v) => setSheet(v as SheetKey)}>
              <TabsList className="h-auto flex-wrap justify-start">
                {problemSheets.map((x) => (
                  <TabsTrigger key={x.sheetKey} value={x.sheetKey}>
                    {x.title}
                    <Badge variant="danger" className="px-1.5 tabular-nums">
                      {x.counts.INVALID}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <ErrorGrid key={current} batchId={s.id} sheetKey={current} disabled={busy} onSubmitted={() => void batch.refresh()} />
          </CardContent>
        </Card>
      )}
      {busy && <PipelineProgress batch={batch} />}
    </>
  );
}

// ----------------------------------------------------------------------------
//  4. Nəticə
// ----------------------------------------------------------------------------

function DoneStep({ batch, onReset }: { batch: Batch; onReset: () => void }) {
  const s = batch.snapshot!;
  const committed = s.sheets.reduce((n, x) => n + x.counts.COMMITTED, 0);
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 18 }}
          className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success"
        >
          <CheckCircle2Icon className="size-7" />
        </motion.div>
        <div>
          <div className="text-lg font-semibold">İdxal tamamlandı</div>
          <div className="mt-1 text-sm text-muted-foreground">
            <span className="tabular-nums">{committed}</span> sətir {s.sheets.length} vərəqdən bazaya yazıldı
          </div>
        </div>
        <div className="grid w-full max-w-xl grid-cols-2 gap-2 text-left sm:grid-cols-3">
          {s.sheets.map((x) => (
            <div key={x.sheetKey} className="rounded-lg border px-3 py-2">
              <div className="truncate text-xs text-muted-foreground">{x.title}</div>
              <div className="font-semibold tabular-nums">{x.counts.COMMITTED}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onReset}>
            <PlusIcon /> Yeni idxal
          </Button>
          <Button asChild>
            <a href="/employees">
              Əməkdaşlara bax <ArrowRightIcon />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
