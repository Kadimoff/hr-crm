"use client";

import { CalendarClockIcon, LoaderIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelDepartmentChangeAction, closeImpactAction, scheduleDepartmentChangeAction, type DeptFormState, type ImpactResult } from "@/actions/structure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DeptOption {
  id: string;
  label: string;
  level: number;
  closed: boolean;
}

const KINDS = [
  { value: "RENAME", label: "Adın dəyişdirilməsi" },
  { value: "MOVE", label: "Tabeliyin dəyişdirilməsi" },
  { value: "MERGE", label: "Başqa bölmə ilə birləşmə" },
  { value: "CLOSE", label: "Bağlanma (ləğv)" },
] as const;

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

/** Struktur dəyişikliyinin planlaşdırılması (TZ M01-01): bu gün — dərhal tətbiq; gələcək tarix — cari struktur dəyişmir */
export function ScheduleChangeForm({ departments, defaultDepartmentId }: { departments: DeptOption[]; defaultDepartmentId?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<DeptFormState, FormData>(scheduleDepartmentChangeAction, {});
  const [kind, setKind] = useState<string>("RENAME");
  const [deptId, setDeptId] = useState(defaultDepartmentId ?? "");
  const [date, setDate] = useState("");
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [loadingImpact, startImpact] = useTransition();
  const handled = useRef<DeptFormState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const open = useMemo(() => departments.filter((d) => !d.closed), [departments]);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      toast.success(state.message ?? "Saxlanıldı", { duration: 8000 });
      formRef.current?.reset();
      setDate("");
      setImpact(null);
      router.refresh();
    } else if (state.error && !state.fieldErrors) toast.error(state.error);
  }, [state, router]);

  // Bağlanma / birləşmə: əlaqələr (aktiv təyinat, açıq alt bölmə, ştat, sənəd, rəhbər hesabı) əvvəlcədən göstərilir (M01-03)
  useEffect(() => {
    if (!deptId || (kind !== "CLOSE" && kind !== "MERGE")) {
      setImpact(null);
      return;
    }
    startImpact(async () => setImpact(await closeImpactAction(deptId, date || undefined)));
  }, [deptId, kind, date]);

  const fe = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <Card data-change-form>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClockIcon className="size-4 text-muted-foreground" /> Struktur dəyişikliyi
        </CardTitle>
        <CardDescription>Bu gün və ya keçmiş tarix — dərhal tətbiq olunur. Gələcək tarix — planlaşdırılır: cari struktur və hesabatlar həmin günə qədər dəyişmir.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            startTransition(() => action(f));
          }}
        >
          <FormField label="Bölmə" htmlFor="ch-dept" error={fe.departmentId} required className="sm:col-span-2">
            <select id="ch-dept" name="departmentId" value={deptId} onChange={(e) => setDeptId(e.currentTarget.value)} className={selectCls}>
              <option value="">— seçin —</option>
              {open.map((d) => (
                <option key={d.id} value={d.id}>
                  {"\u00a0\u00a0".repeat(d.level - 1)}
                  {d.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Dəyişiklik" htmlFor="ch-kind" error={fe.kind} required>
            <select id="ch-kind" name="kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)} className={selectCls}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Qüvvəyə minir" htmlFor="ch-date" error={fe.effectiveDate} required>
            <DateInput id="ch-date" name="effectiveDate" value={date} onChange={setDate} />
          </FormField>
          {kind === "RENAME" && (
            <FormField label="Yeni ad" htmlFor="ch-name" error={fe.newName} required className="sm:col-span-2">
              <Input id="ch-name" name="newName" />
            </FormField>
          )}
          {kind === "MOVE" && (
            <FormField label="Yeni üst bölmə" htmlFor="ch-parent" error={fe.newParentId} required className="sm:col-span-2">
              <select id="ch-parent" name="newParentId" defaultValue="" className={selectCls}>
                <option value="root">— 1-ci səviyyə (kök) —</option>
                {open
                  .filter((d) => d.id !== deptId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {"\u00a0\u00a0".repeat(d.level - 1)}
                      {d.label}
                    </option>
                  ))}
              </select>
            </FormField>
          )}
          {kind === "MERGE" && (
            <FormField label="Birləşdiyi (qalan) bölmə" htmlFor="ch-target" error={fe.targetDepartmentId} required className="sm:col-span-2">
              <select id="ch-target" name="targetDepartmentId" defaultValue="" className={selectCls}>
                <option value="">— seçin —</option>
                {open
                  .filter((d) => d.id !== deptId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {"\u00a0\u00a0".repeat(d.level - 1)}
                      {d.label}
                    </option>
                  ))}
              </select>
            </FormField>
          )}
          <FormField label="Əmrin nömrəsi" htmlFor="ch-order" error={fe.orderNumber}>
            <Input id="ch-order" name="orderNumber" />
          </FormField>
          <FormField label="Əmrin tarixi" htmlFor="ch-order-date" error={fe.orderDate}>
            <DateInput id="ch-order-date" name="orderDate" />
          </FormField>
          <FormField label="Qeyd" htmlFor="ch-note" error={fe.note} className="sm:col-span-2">
            <Input id="ch-note" name="note" />
          </FormField>
          {(kind === "CLOSE" || kind === "MERGE") && deptId && (
            <div className={cn("rounded-lg border px-3 py-2.5 text-sm sm:col-span-2", impact?.blockers?.length ? "border-danger/40 bg-danger-soft" : "bg-muted/40")} data-close-impact>
              {loadingImpact || !impact ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <LoaderIcon className="size-4 animate-spin" /> Əlaqələr yoxlanılır…
                </span>
              ) : impact.impact ? (
                <>
                  <div className="font-medium">Bağlanmadan əvvəl əlaqələr</div>
                  <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
                    <li>Aktiv təyinat (müqavilə): {impact.impact.activeEmployments}</li>
                    <li>Bağlanmamış alt bölmə: {impact.impact.openChildren}</li>
                    <li>Ştat cədvəli sətirləri: {impact.impact.staffingUnits}</li>
                    <li>Əsasnamə / vəzifə təlimatı: {impact.impact.documents}</li>
                    <li>Bölməyə bağlı rəhbər hesabı: {impact.impact.headUsers}</li>
                  </ul>
                  {impact.blockers?.length ? (
                    <p className="mt-1.5 text-xs text-danger" data-close-blocked>
                      {impact.blockers.join("; ")}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">Ştat, sənəd və keçmiş hesabatlar köhnə bölmənin adı ilə tarixçədə qalır — yeni struktura səssiz yazılmır.</p>
                  )}
                </>
              ) : (
                <span className="text-danger">{impact.error}</span>
              )}
            </div>
          )}
          {state.error && !state.ok && state.fieldErrors && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{state.error}</p>}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={pending} data-change-submit>
              {pending && <LoaderIcon className="animate-spin" />} Saxla
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function CancelChangeButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-danger"
      disabled={pending}
      onClick={() =>
        confirm(`Planlaşdırılmış dəyişiklik ləğv edilsin?\n${label}`) &&
        start(async () => {
          const r = await cancelDepartmentChangeAction(id);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Ləğv edildi");
            router.refresh();
          }
        })
      }
      data-cancel-change
    >
      {pending ? <LoaderIcon className="animate-spin" /> : <XIcon />} Ləğv et
    </Button>
  );
}
