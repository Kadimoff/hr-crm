"use client";

import { LoaderIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { acknowledgeJobDescriptionAction, savePositionCatalogAction, type RegulationFormState } from "@/actions/regulations";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm shadow-xs";

export function PositionCatalogForm({ id, jobFamily, classCode, gradeCode, classes }: { id: string; jobFamily: string | null; classCode: string | null; gradeCode: string | null; classes: { value: string; label: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<RegulationFormState, FormData>(savePositionCatalogAction, {});
  const handled = useRef<RegulationFormState | null>(null);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      toast.success("Yadda saxlanıldı");
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);
  const fe = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => action(f));
      }}
      data-catalog-form
    >
      <input type="hidden" name="id" value={id} />
      <FormField label="Peşə ailəsi" htmlFor="cf-family" error={fe.jobFamily}>
        <Input id="cf-family" name="jobFamily" defaultValue={jobFamily ?? ""} placeholder="məs. Maliyyə" />
      </FormField>
      <FormField label="Təsnifat (A1/A2/N1–N5)" htmlFor="cf-class" error={fe.classCode}>
        <select id="cf-class" name="classCode" defaultValue={classCode ?? ""} className={selectCls}>
          <option value="">— seçilməyib —</option>
          {classes.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Grade" htmlFor="cf-grade" error={fe.gradeCode} hint="Gələcək maaş şkalası (M11) üçün">
        <Input id="cf-grade" name="gradeCode" defaultValue={gradeCode ?? ""} placeholder="məs. G5" className="font-mono" />
      </FormField>
      <div className="flex justify-end sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <LoaderIcon className="animate-spin" />} Yadda saxla
        </Button>
      </div>
    </form>
  );
}

/** Tanışlığı qeyd et (əməkdaş kağız vərəqdə imzalayıb) — bir və ya seçilmiş bir neçə tapşırıq */
export function AckButton({ ids, label = "Tanış oldu", undo = false }: { ids: string[]; label?: string; undo?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const run = (d: string | null) =>
    start(async () => {
      const r = await acknowledgeJobDescriptionAction(ids, d);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.message ?? "Saxlanıldı");
        setOpen(false);
        router.refresh();
      }
    });
  if (undo)
    return (
      <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => confirm("Tanışlıq qeydi geri alınsın?") && run(null)} data-ack-undo>
        Geri al
      </Button>
    );
  if (!open)
    return (
      <Button size="sm" variant="outline" disabled={ids.length === 0} onClick={() => setOpen(true)} data-ack-open>
        {label}
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-ack-form>
      <DateInput value={date} onChange={setDate} className="w-32" aria-label="Tanışlıq tarixi" />
      <Button size="sm" disabled={pending || !date} onClick={() => run(date)} data-ack-save>
        {pending && <LoaderIcon className="animate-spin" />} Qeyd et
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        ×
      </Button>
    </span>
  );
}
