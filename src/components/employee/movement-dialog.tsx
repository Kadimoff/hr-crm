"use client";

import { ArrowRightLeftIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { recordMovementAction, type MovementFormState } from "@/actions/persons";
import { MovementOrderFields } from "@/components/employee/movement-fields";
import { FormSelect } from "@/components/employee/person-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import type { MovementKindCode } from "@/lib/movement-rules";
import type { PersonFormOptions } from "@/lib/queries";

export interface MovementEmployment {
  id: string;
  label: string;
  departmentId: string;
  positionId: string;
  baseSalary: number;
  unitShare: number;
}

/** Dosyedə «Kadr hərəkəti» — növ (köçürmə, vəzifə artımı, maaş / ştat dəyişikliyi), əmr nömrəsi, əmr və qüvvəyə minmə tarixi, yeni bölmə / vəzifə / oklad / ştat payı */
export function MovementDialog({ personId, updatedAt, employments, options }: { personId: string; updatedAt: string; employments: MovementEmployment[]; options: PersonFormOptions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<MovementFormState, FormData>(recordMovementAction, {});
  const [empId, setEmpId] = useState(employments[0]?.id ?? "");
  const emp = employments.find((e) => e.id === empId) ?? employments[0];
  const [sel, setSel] = useState({ departmentId: emp?.departmentId ?? "", positionId: emp?.positionId ?? "" });
  const [kind, setKind] = useState<MovementKindCode | "">("");

  useEffect(() => {
    if (!state.ok) return;
    toast.success("Kadr hərəkəti qeydə alındı", { description: "Müqavilə, oklad tarixçəsi və Hərəkət hesabatı yeniləndi" });
    setOpen(false);
    router.refresh();
  }, [state, router]);

  if (!emp) return null;
  const fe = state.ok ? {} : (state.fieldErrors ?? {});

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setSel({ departmentId: emp.departmentId, positionId: emp.positionId });
          setKind("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowRightLeftIcon /> Kadr hərəkəti
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form
          key={`${String(open)}-${emp.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => action(data));
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="updatedAt" value={updatedAt} />
          <DialogHeader>
            <DialogTitle>Kadr hərəkəti: köçürmə, vəzifə artımı, maaş dəyişikliyi</DialogTitle>
            <DialogDescription>
              Əmr əsasında: müqavilə yeni vəziyyətə keçir, əvvəlki dəyərlər kadr hərəkətləri və maliyyə tarixçəsində saxlanılır, oklad tarixçəsi qüvvəyə minmə tarixindən yenilənir.
            </DialogDescription>
          </DialogHeader>
          {employments.length > 1 ? (
            <FormField label="Müqavilə" htmlFor="employmentId" error={fe.employmentId} required>
              <FormSelect
                name="employmentId"
                value={emp.id}
                onChange={(v) => {
                  const next = employments.find((e) => e.id === v);
                  setEmpId(v);
                  if (next) setSel({ departmentId: next.departmentId, positionId: next.positionId });
                }}
                options={employments.map((e) => ({ value: e.id, label: e.label }))}
                placeholder="Seçin"
              />
            </FormField>
          ) : (
            <input type="hidden" name="employmentId" value={emp.id} />
          )}
          <MovementOrderFields fe={fe} notice={false} kind={{ value: kind, onChange: setKind }} />
          {kind === "PROMOTION" && (
            <p className="-mt-1 text-xs text-muted-foreground" data-promotion-hint>
              Vəzifə artımında <b>yeni vəzifə məcburidir</b>; adətən yeni oklad da daxil edilir.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Struktur bölmə" htmlFor="departmentId" error={fe.departmentId} required>
              <FormSelect name="departmentId" value={sel.departmentId} onChange={(v) => setSel((s) => ({ ...s, departmentId: v }))} options={options.departments} placeholder="Seçin" invalid={!!fe.departmentId} />
            </FormField>
            <FormField label={kind === "PROMOTION" ? "Yeni vəzifə" : "Vəzifə"} htmlFor="positionId" error={fe.positionId} required>
              <FormSelect name="positionId" value={sel.positionId} onChange={(v) => setSel((s) => ({ ...s, positionId: v }))} options={options.positions} placeholder="Seçin" invalid={!!fe.positionId} />
            </FormField>
            <FormField label="Oklad (₼)" htmlFor="baseSalary" error={fe.baseSalary} required>
              <Input id="baseSalary" name="baseSalary" type="number" step="0.01" min="0" defaultValue={emp.baseSalary} className="tabular-nums" aria-invalid={!!fe.baseSalary} />
            </FormField>
            <FormField label="Ştat payı" htmlFor="unitShare" error={fe.unitShare} required>
              <Input id="unitShare" name="unitShare" type="number" step="0.25" min="0.25" max="2" defaultValue={emp.unitShare} aria-invalid={!!fe.unitShare} />
            </FormField>
          </div>
          <FormField label="Qeyd" htmlFor="note" error={fe.note}>
            <Input id="note" name="note" maxLength={300} placeholder="İstəyə görə — məs. köçürmənin səbəbi" />
          </FormField>
          {state.error && !state.fieldErrors && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <ArrowRightLeftIcon />} Qeydə al
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
