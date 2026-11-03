"use client";

import { LockIcon } from "lucide-react";
import type * as React from "react";
import { Input } from "@/components/ui/input";
import { SALARY_HIDDEN_LABEL } from "@/lib/salary-privacy";

/**
 * Oklad sahəsi. locked — dəyişdirilə bilməz: sahə disabled və `name`-siz göndərilir (formadan gəlməyəndə server mövcud
 * okladı saxlayır, SİLMİR); hidden — rəqəm serverdən gəlməyib, yerində «Məxfi».
 */
export function SalaryInput({
  locked,
  hidden,
  value,
  ...props
}: { locked?: boolean; hidden?: boolean; value?: number | string | null } & Omit<React.ComponentProps<typeof Input>, "value" | "defaultValue">) {
  if (locked || hidden) {
    return (
      <div className="relative" data-salary-locked>
        <Input
          id={props.id}
          type="text"
          disabled
          value={hidden || value === null || value === undefined ? "" : String(value)}
          placeholder={SALARY_HIDDEN_LABEL}
          className="pr-8 tabular-nums"
          title={hidden ? "Maaş məxfidir" : "Okladı yalnız root və ya səlahiyyətli hesab dəyişə bilər"}
        />
        <LockIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    );
  }
  return <Input type="number" step="0.01" min="0" defaultValue={value ?? undefined} className="tabular-nums" {...props} />;
}
