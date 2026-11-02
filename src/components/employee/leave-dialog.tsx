"use client";

import { Ban, Loader2Icon, PlaneIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { cancelLeaveAction, recordLeaveAction, type MovementFormState } from "@/actions/persons";
import { todayIso } from "@/components/employee/movement-fields";
import { FormSelect } from "@/components/employee/person-form";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { ORDER_LEAVE_LABELS, ORDER_LEAVE_TYPES, type OrderLeaveType } from "@/lib/leave-rules";

const isoToDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null);

/** Dosyedə «Ödənişsiz məzuniyyət» — əmr əsasında: növ (ö/m, ö/sm), əmr nömrəsi və tarixi, başlama və bitmə tarixi, qeyd */
export function LeaveDialog({ personId, updatedAt }: { personId: string; updatedAt: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<MovementFormState, FormData>(recordLeaveAction, {});
  const [type, setType] = useState<OrderLeaveType>("UNPAID");
  const [range, setRange] = useState({ start: "", end: "" });

  useEffect(() => {
    if (!state.ok) return;
    toast.success("Ödənişsiz məzuniyyət qeydə alındı", { description: "Staj, hərəkət tarixçəsi və «Kadr hərəkəti» hesabatı yeniləndi" });
    setOpen(false);
    router.refresh();
  }, [state, router]);

  const fe = state.ok ? {} : (state.fieldErrors ?? {});
  const s = isoToDate(range.start);
  const e = isoToDate(range.end);
  const days = s && e && e >= s ? Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1 : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setType("UNPAID");
          setRange({ start: "", end: "" });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PlaneIcon /> Ödənişsiz məzuniyyət
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          key={String(open)}
          onSubmit={(ev) => {
            ev.preventDefault();
            const data = new FormData(ev.currentTarget);
            startTransition(() => action(data));
          }}
          className="flex flex-col gap-4"
          noValidate
          data-leave-form
        >
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="updatedAt" value={updatedAt} />
          <DialogHeader>
            <DialogTitle>Ödənişsiz məzuniyyət</DialogTitle>
            <DialogDescription>
              Əmr əsasında. Ödənişsiz məzuniyyətin (ö/m) iş ilində 14 gündən artıq hissəsi əmək stajından çıxılır; dövr başqa məzuniyyət / iştirak etməmə ilə kəsişə bilməz.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Növ" htmlFor="type" error={fe.type} required>
            <FormSelect
              name="type"
              value={type}
              onChange={(v) => setType((v || "UNPAID") as OrderLeaveType)}
              options={ORDER_LEAVE_TYPES.map((t) => ({ value: t, label: ORDER_LEAVE_LABELS[t] }))}
              placeholder="Seçin"
              invalid={!!fe.type}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Əmrin nömrəsi" htmlFor="leave-orderNumber" error={fe.orderNumber} required>
              <Input id="leave-orderNumber" name="orderNumber" placeholder="məs. 210-M" maxLength={64} aria-invalid={!!fe.orderNumber} />
            </FormField>
            <FormField label="Əmrin tarixi" htmlFor="leave-orderDate" error={fe.orderDate} required>
              <DateInput id="leave-orderDate" name="orderDate" defaultValue={todayIso()} aria-invalid={!!fe.orderDate} />
            </FormField>
            <FormField label="Başlama tarixi" htmlFor="leave-startDate" error={fe.startDate} required>
              <DateInput id="leave-startDate" name="startDate" value={range.start} onChange={(v) => setRange((r) => ({ ...r, start: v }))} aria-invalid={!!fe.startDate} />
            </FormField>
            <FormField label="Bitmə tarixi" htmlFor="leave-endDate" error={fe.endDate} required>
              <DateInput id="leave-endDate" name="endDate" value={range.end} onChange={(v) => setRange((r) => ({ ...r, end: v }))} aria-invalid={!!fe.endDate} />
            </FormField>
          </div>
          {days !== null && (
            <p className="-mt-1 text-xs text-muted-foreground" data-leave-days>
              Müddət: <b className="tabular-nums">{days}</b> təqvim günü
            </p>
          )}
          <FormField label="Qeyd" htmlFor="leave-note" error={fe.note}>
            <Input id="leave-note" name="note" maxLength={300} placeholder="İstəyə görə — məs. ərizə əsasında" />
          </FormField>
          {state.error && !state.fieldErrors && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <PlaneIcon />} Qeydə al
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Səhv daxil edilmiş əmrli məzuniyyətin ləğvi — səbəb məcburidir, audit jurnalına yazılır */
export function CancelLeaveButton({ absenceId, label }: { absenceId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<MovementFormState, FormData>(cancelLeaveAction, {});
  useEffect(() => {
    if (!state.ok) return;
    toast.success("Məzuniyyət ləğv edildi", { description: "Staj və hesabat yenidən hesablandı; ləğv audit jurnalına yazıldı" });
    setOpen(false);
    router.refresh();
  }, [state, router]);
  const fe = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-danger hover:text-danger" data-cancel-leave>
          <Ban /> Ləğv et
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          key={String(open)}
          onSubmit={(ev) => {
            ev.preventDefault();
            const data = new FormData(ev.currentTarget);
            startTransition(() => action(data));
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" name="absenceId" value={absenceId} />
          <DialogHeader>
            <DialogTitle>Məzuniyyəti ləğv etmək</DialogTitle>
            <DialogDescription>{label}. Qeyd silinmir — «ləğv edilib» kimi qalır, stajdan və hesabatdan çıxır.</DialogDescription>
          </DialogHeader>
          <FormField label="Ləğvin səbəbi" htmlFor="cancel-reason" error={fe.reason} required>
            <Input id="cancel-reason" name="reason" maxLength={300} placeholder="məs. səhv əməkdaşa daxil edilib" aria-invalid={!!fe.reason} />
          </FormField>
          {state.error && !state.fieldErrors && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <Ban />} Ləğv et
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
