"use client";

import { FileSignatureIcon } from "lucide-react";
import { useState } from "react";
import { FormSelect } from "@/components/employee/person-form";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { MOVEMENT_KIND_LABELS, MOVEMENT_KINDS, type MovementKindCode } from "@/lib/movement-rules";
import { cn } from "@/lib/utils";

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const KIND_OPTIONS = MOVEMENT_KINDS.map((k) => ({ value: k, label: MOVEMENT_KIND_LABELS[k] }));

/**
 * Kadr hərəkətinin əmri: növ, nömrə, əmrin tarixi, qüvvəyə minmə tarixi.
 * Bölmə / vəzifə / oklad / ştat payı dəyişəndə tam formada, struktur xəritəsinin panelində və dosyedəki formada eyni sahələr.
 * kind verilməyibsə (tam forma, sürətli redaktə) — növ istəyə görədir, boş qalsa dəyişikliyə görə təyin olunur.
 */
export function MovementOrderFields({
  fe,
  notice = true,
  className,
  kind,
}: {
  fe: Record<string, string | undefined>;
  notice?: boolean;
  className?: string;
  kind?: { value: string; onChange: (v: MovementKindCode | "") => void };
}) {
  const [own, setOwn] = useState("");
  const value = kind ? kind.value : own;
  const onChange = (v: string) => (kind ? kind.onChange(v as MovementKindCode | "") : setOwn(v));
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft/40 p-3", className)} data-movement-fields>
      {notice && (
        <p className="flex gap-2 text-xs text-foreground">
          <FileSignatureIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            Bölmə, vəzifə, oklad və ya ştat payı dəyişir — bu, <b>əmr əsasında kadr hərəkəti</b> kimi qeydə alınacaq: tarixçədə, maliyyə tarixçəsində və «Kadr hərəkəti»
            hesabatında görünəcək, oklad tarixçəsi qüvvəyə minmə tarixindən yenilənəcək.
          </span>
        </p>
      )}
      <FormField label="Hərəkətin növü" htmlFor="movementKind" error={fe.movementKind} required={!!kind}>
        <FormSelect
          name="movementKind"
          value={value}
          onChange={onChange}
          options={KIND_OPTIONS}
          placeholder={kind ? "Seçin" : "Avtomatik — dəyişikliyə görə"}
          optional={!kind}
          invalid={!!fe.movementKind}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Əmrin nömrəsi" htmlFor="orderNumber" error={fe.orderNumber} required>
          <Input id="orderNumber" name="orderNumber" placeholder="məs. 125-K" maxLength={64} aria-invalid={!!fe.orderNumber} className={cn(fe.orderNumber && "border-danger")} />
        </FormField>
        <FormField label="Əmrin tarixi" htmlFor="orderDate" error={fe.orderDate} required>
          <DateInput id="orderDate" name="orderDate" defaultValue={todayIso()} aria-invalid={!!fe.orderDate} />
        </FormField>
        <FormField label="Qüvvəyə minmə tarixi" htmlFor="effectiveDate" error={fe.effectiveDate} required>
          <DateInput id="effectiveDate" name="effectiveDate" defaultValue={todayIso()} aria-invalid={!!fe.effectiveDate} />
        </FormField>
      </div>
    </div>
  );
}
