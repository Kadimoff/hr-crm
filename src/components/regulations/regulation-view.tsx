"use client";

import type { RegulationStatus } from "@prisma/client";
import { CheckCircle2Icon, CopyPlusIcon, DownloadIcon, FileUpIcon, LoaderIcon, PrinterIcon, ScaleIcon, Undo2Icon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createRegulationAction, saveRegulationAction, transitionRegulationAction, type RegulationFormState } from "@/actions/regulations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { REGULATION_TEXT_FIELDS, REGULATION_TITLES, regulationHref, regulationPrintHref, type RegulationKind } from "@/lib/regulation-fields";
import { REGULATION_STATUS_LABELS, REGULATION_STATUS_TONE } from "@/lib/regulations";
import { cn, formatIsoDate } from "@/lib/utils";

export interface RegulationDTO {
  kind: RegulationKind;
  id: string;
  version: number;
  status: RegulationStatus;
  title: string;
  texts: Record<string, string | null>;
  nextReviewOn: string | null;
  approvedOn: string | null;
  approvedBy: string | null;
  orderNumber: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  legalReviewText: string | null;
  legalReviewDate: string | null;
  legalReviewBy: string | null;
  file: { name: string; size: number } | null;
  owner: { label: string; href: string; departmentId: string | null; positionId: string | null };
  versions: { id: string; version: number; status: RegulationStatus; approvedOn: string | null; effectiveFrom: string | null; effectiveTo: string | null }[];
  createdBy: string | null;
  approvedByUser: string | null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function RegulationStatusBadge({ status }: { status: RegulationStatus }) {
  return (
    <Badge variant={REGULATION_STATUS_TONE[status]} data-reg-status={status}>
      {REGULATION_STATUS_LABELS[status]}
    </Badge>
  );
}

export function RegulationView({ data, canEdit, canApprove }: { data: RegulationDTO; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const editable = canEdit && (data.status === "QARALAMA" || data.status === "HUQUQI_REYDE");
  const fields = REGULATION_TEXT_FIELDS[data.kind];
  const [saveState, saveAction, saving] = useActionState<RegulationFormState, FormData>(saveRegulationAction, {});
  const [trState, trAction, moving] = useActionState<RegulationFormState, FormData>(transitionRegulationAction, {});
  const [approveOpen, setApproveOpen] = useState(false);
  const [creating, startCreate] = useTransition();
  const [uploading, setUploading] = useState(false);
  const handled = useRef<RegulationFormState | null>(null);
  const hasDraft = data.versions.some((v) => v.status === "QARALAMA" || v.status === "HUQUQI_REYDE");

  useEffect(() => {
    for (const s of [saveState, trState]) {
      if (s === handled.current) continue;
      if (s.ok) {
        handled.current = s;
        toast.success(s.message ?? "Yadda saxlanıldı");
        setApproveOpen(false);
        router.refresh();
      } else if (s.error && !s.fieldErrors) {
        handled.current = s;
        toast.error(s.error);
      }
    }
  }, [saveState, trState, router]);

  const transition = (to: RegulationStatus, extra?: FormData) => {
    const f = extra ?? new FormData();
    f.set("kind", data.kind);
    f.set("id", data.id);
    f.set("to", to);
    startTransition(() => trAction(f));
  };

  const newVersion = () =>
    startCreate(async () => {
      const r = await createRegulationAction(data.kind, { departmentId: data.owner.departmentId, positionId: data.owner.positionId ?? undefined }, data.id);
      if (r.error) toast.error(r.error);
      else if (r.id) {
        toast.success("Yeni versiya (qaralama) yaradıldı");
        router.push(regulationHref(data.kind, r.id));
      }
    });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const f = new FormData();
      f.set("file", file);
      const res = await fetch(`/api/regulations/${data.kind}/${data.id}/file`, { method: "POST", body: f });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(j.error ?? "Fayl yüklənmədi");
      else {
        toast.success("Fayl əlavə edildi");
        router.refresh();
      }
    } finally {
      setUploading(false);
    }
  };
  const canUpload = canEdit && (editable || (data.status === "TESDIQLENIB" && !data.file));
  const fe = saveState.ok ? {} : (saveState.fieldErrors ?? {});

  return (
    <div className="flex flex-col gap-4" data-regulation={data.kind}>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <RegulationStatusBadge status={data.status} />
            <Badge variant="outline">v{data.version}</Badge>
            <Link href={data.owner.href} className="text-sm text-primary hover:underline">
              {data.owner.label}
            </Link>
          </div>
          <CardTitle className="text-base break-words">{data.title}</CardTitle>
          <CardDescription>
            {data.status === "TESDIQLENIB" || data.status === "QUVVEDEN_DUSUB"
              ? `Təsdiq: ${formatIsoDate(data.approvedOn)} · ${data.approvedBy ?? "—"}${data.orderNumber ? ` · əmr № ${data.orderNumber}` : ""} · qüvvədədir ${formatIsoDate(data.effectiveFrom)}${data.effectiveTo ? ` – ${formatIsoDate(data.effectiveTo)}` : ""}`
              : "Təsdiqlənənə qədər mətn dəyişdirilə bilər. Təsdiqlənmiş versiya dəyişdirilmir — yeni versiya yaradılır."}
            {data.kind === "charter" && data.nextReviewOn && ` · növbəti baxış ${formatIsoDate(data.nextReviewOn)}`}
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" asChild>
              <a href={regulationPrintHref(data.kind, data.id)} target="_blank" rel="noreferrer" data-reg-print>
                <PrinterIcon /> Çap
              </a>
            </Button>
            {data.file && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/regulations/${data.kind}/${data.id}/file`} target="_blank" rel="noreferrer">
                  <DownloadIcon /> {data.file.name.length > 28 ? `${data.file.name.slice(0, 26)}…` : data.file.name}
                </a>
              </Button>
            )}
            {canUpload && (
              <label className={cn("inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted", uploading && "opacity-50")}>
                {uploading ? <LoaderIcon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
                {data.file ? "Faylı əvəz et" : data.status === "TESDIQLENIB" ? "İmzalı nüsxəni əlavə et" : "Fayl əlavə et"}
                <input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.docx,.doc,.tif,.tiff" onChange={(e) => e.currentTarget.files?.[0] && upload(e.currentTarget.files[0])} data-reg-file />
              </label>
            )}
            {canEdit && data.status === "QARALAMA" && (
              <Button size="sm" variant="outline" disabled={moving} onClick={() => transition("HUQUQI_REYDE")} data-reg-to="HUQUQI_REYDE">
                <ScaleIcon /> Hüquqi rəyə göndər
              </Button>
            )}
            {canEdit && data.status === "HUQUQI_REYDE" && (
              <Button size="sm" variant="outline" disabled={moving} onClick={() => transition("QARALAMA")} data-reg-to="QARALAMA">
                <Undo2Icon /> Qaralamaya qaytar
              </Button>
            )}
            {canApprove && (data.status === "QARALAMA" || data.status === "HUQUQI_REYDE") && (
              <Button size="sm" variant="success" onClick={() => setApproveOpen(true)} data-reg-approve>
                <CheckCircle2Icon /> Təsdiq et
              </Button>
            )}
            {canApprove && data.status === "TESDIQLENIB" && (
              <Button
                size="sm"
                variant="outline"
                className="text-danger"
                disabled={moving}
                onClick={() => confirm("Bu versiya qüvvədən salınsın? (yeni versiya təsdiqlənəndə bu avtomatik olur)") && transition("QUVVEDEN_DUSUB")}
                data-reg-to="QUVVEDEN_DUSUB"
              >
                <XCircleIcon /> Qüvvədən sal
              </Button>
            )}
            {canEdit && !hasDraft && (data.status === "TESDIQLENIB" || data.status === "QUVVEDEN_DUSUB") && (
              <Button size="sm" variant="outline" disabled={creating} onClick={newVersion} data-reg-new-version>
                {creating ? <LoaderIcon className="animate-spin" /> : <CopyPlusIcon />} Yeni versiya
              </Button>
            )}
          </div>
          {!canApprove && canEdit && (data.status === "QARALAMA" || data.status === "HUQUQI_REYDE") && (
            <p className="text-xs text-muted-foreground">Təsdiq üçün root və ya «təsdiq edə bilər» icazəsi olan hesab lazımdır.</p>
          )}
        </CardHeader>
      </Card>

      {editable ? (
        <form
          action={saveAction}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            startTransition(() => saveAction(f));
          }}
          data-reg-form
        >
          <input type="hidden" name="kind" value={data.kind} />
          <input type="hidden" name="id" value={data.id} />
          <Card>
            <CardContent className="flex flex-col gap-4 pt-5">
              <FormField label="Adı" htmlFor="reg-title" error={fe.title} required>
                <Input id="reg-title" name="title" defaultValue={data.title} />
              </FormField>
              {fields.map((f) => (
                <FormField key={f.key} label={f.label} htmlFor={`reg-${f.key}`} error={fe[f.key]} hint={f.hint}>
                  {f.long ? (
                    <textarea
                      id={`reg-${f.key}`}
                      name={f.key}
                      defaultValue={data.texts[f.key] ?? ""}
                      rows={5}
                      className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    />
                  ) : (
                    <Input id={`reg-${f.key}`} name={f.key} defaultValue={data.texts[f.key] ?? ""} />
                  )}
                </FormField>
              ))}
              {data.kind === "charter" && (
                <FormField label="Növbəti baxış tarixi" htmlFor="reg-review" error={fe.nextReviewOn} hint="Əsasnaməyə yenidən baxılmalı olan tarix (gecikəndə reyestrdə işarələnir)">
                  <DateInput id="reg-review" name="nextReviewOn" defaultValue={day(data.nextReviewOn)} className="w-40" />
                </FormField>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Hüquqi rəy</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Rəy" htmlFor="reg-legal" className="sm:col-span-2" error={fe.legalReviewText}>
                <textarea id="reg-legal" name="legalReviewText" defaultValue={data.legalReviewText ?? ""} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs" />
              </FormField>
              <FormField label="Rəyin tarixi" htmlFor="reg-legal-date" error={fe.legalReviewDate}>
                <DateInput id="reg-legal-date" name="legalReviewDate" defaultValue={day(data.legalReviewDate)} />
              </FormField>
              <FormField label="Rəyi verən" htmlFor="reg-legal-by" error={fe.legalReviewBy}>
                <Input id="reg-legal-by" name="legalReviewBy" defaultValue={data.legalReviewBy ?? ""} placeholder="Hüquq şöbəsi" />
              </FormField>
            </CardContent>
          </Card>
          {saveState.error && !saveState.ok && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{saveState.error}</p>}
          <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 bg-background/90 px-1 py-2 backdrop-blur">
            <Button type="submit" disabled={saving} data-reg-save>
              {saving && <LoaderIcon className="animate-spin" />} Yadda saxla
            </Button>
          </div>
        </form>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5">
            {fields.map((f) => (
              <div key={f.key}>
                <div className="text-xs font-medium text-muted-foreground">{f.label}</div>
                <div className="mt-1 text-sm whitespace-pre-wrap break-words">{data.texts[f.key] || "—"}</div>
              </div>
            ))}
            {(data.legalReviewText || data.legalReviewDate) && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground">
                  Hüquqi rəy · {formatIsoDate(data.legalReviewDate)} · {data.legalReviewBy ?? "—"}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{data.legalReviewText || "—"}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Versiyalar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {data.versions.map((v) => (
            <Link
              key={v.id}
              href={regulationHref(data.kind, v.id)}
              className={cn("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted", v.id === data.id && "border-primary/50 bg-accent")}
              data-reg-version={v.version}
            >
              <span className="font-medium">v{v.version}</span>
              <RegulationStatusBadge status={v.status} />
              <span className="text-xs text-muted-foreground">
                {v.effectiveFrom ? `${formatIsoDate(v.effectiveFrom)}${v.effectiveTo ? ` – ${formatIsoDate(v.effectiveTo)}` : " —"}` : "təsdiqlənməyib"}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <ApproveDialog open={approveOpen} onClose={() => setApproveOpen(false)} pending={moving} errors={trState.ok ? {} : (trState.fieldErrors ?? {})} error={trState.ok ? undefined : trState.error} onSubmit={(f) => transition("TESDIQLENIB", f)} kind={data.kind} />
    </div>
  );
}

function ApproveDialog({
  open,
  onClose,
  onSubmit,
  pending,
  errors,
  error,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (f: FormData) => void;
  pending: boolean;
  errors: Record<string, string>;
  error?: string;
  kind: RegulationKind;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
        >
          <DialogHeader>
            <DialogTitle>{REGULATION_TITLES[kind].one} — təsdiq</DialogTitle>
            <DialogDescription>
              Təsdiqdən sonra mətn və fayl dəyişdirilmir; əvvəlki qüvvədə olan versiya avtomatik «Qüvvədən düşüb» olur.
              {kind === "jd" && " Vəzifədəki əməkdaşlara tanışlıq tapşırığı yaranır."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Təsdiq tarixi" htmlFor="ap-date" error={errors.approvedOn} required>
              <DateInput id="ap-date" name="approvedOn" defaultValue={today} />
            </FormField>
            <FormField label="Qüvvəyə minir" htmlFor="ap-from" error={errors.effectiveFrom} hint="Boş — təsdiq tarixi">
              <DateInput id="ap-from" name="effectiveFrom" />
            </FormField>
          </div>
          <FormField label="Təsdiq edən" htmlFor="ap-by" error={errors.approvedBy} required>
            <Input id="ap-by" name="approvedBy" placeholder="Rektor" defaultValue="Rektor" />
          </FormField>
          <FormField label="Əmrin nömrəsi" htmlFor="ap-order" error={errors.orderNumber}>
            <Input id="ap-order" name="orderNumber" />
          </FormField>
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Ləğv et
            </Button>
            <Button type="submit" variant="success" disabled={pending} data-reg-approve-submit>
              {pending && <LoaderIcon className="animate-spin" />} Təsdiq et
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Yeni əsasnamə / təlimat» düyməsi — qaralama yaradıb onun səhifəsinə keçir */
export function CreateRegulationButton({ kind, departmentId, positionId, label, size = "sm" }: { kind: RegulationKind; departmentId?: string | null; positionId?: string; label?: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createRegulationAction(kind, { departmentId: departmentId ?? null, positionId });
          if (r.error) toast.error(r.error);
          else if (r.id) router.push(regulationHref(kind, r.id));
        })
      }
      data-reg-create={kind}
    >
      {pending ? <LoaderIcon className="animate-spin" /> : <CopyPlusIcon />} {label ?? `Yeni ${REGULATION_TITLES[kind].one.toLocaleLowerCase("az")}`}
    </Button>
  );
}
