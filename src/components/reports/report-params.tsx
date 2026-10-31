"use client";

import { DownloadIcon, PrinterIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Hesabat parametrləri URL-də saxlanılır; Excel və çap eyni parametrlərlə açılır */
export function ReportParams({ reportKey, params, defaults }: { reportKey: string; params: ("period" | "status")[]; defaults: { from: string; to: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const update = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    next.set("r", reportKey);
    if (v) next.set(k, v);
    else next.delete(k);
    router.push(`${pathname}?${next}`);
  };
  const query = new URLSearchParams(sp);
  query.delete("r");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {params.includes("period") && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <DateInput aria-label="Dövrün başlanğıcı" value={sp.get("from") ?? defaults.from} onChange={(v) => update("from", v)} className="w-36" />
          –
          <DateInput aria-label="Dövrün sonu" value={sp.get("to") ?? defaults.to} onChange={(v) => update("to", v)} className="w-36" />
        </div>
      )}
      {params.includes("status") && (
        <Select value={sp.get("status") ?? "active"} onValueChange={(v) => update("status", v === "active" ? "" : v)}>
          <SelectTrigger aria-label="Status" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Yalnız işləyənlər</SelectItem>
            <SelectItem value="all">Azad olunanlar daxil</SelectItem>
          </SelectContent>
        </Select>
      )}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`/reports/print?r=${reportKey}&${query}`} target="_blank">
            <PrinterIcon /> Çap
          </a>
        </Button>
        <Button size="sm" asChild>
          <a href={`/api/reports/${reportKey}?${query}`} download>
            <DownloadIcon /> Excel
          </a>
        </Button>
      </div>
    </div>
  );
}
