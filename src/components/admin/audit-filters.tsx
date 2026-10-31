"use client";

import { RotateCcwIcon, SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";

type Opt = { value: string; label: string };

/** Filtrlər URL parametrlərində saxlanılır — server səhifəsi onları oxuyur */
export function AuditFilters({ users, actions, entities }: { users: string[]; actions: Opt[]; entities: Opt[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    router.push(`${pathname}?${next}`);
  };

  // Axtarış sahəsi — yazmağı bitirdikdən 400 ms sonra tətbiq olunur
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q: q.trim() || undefined }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const select = (key: string, placeholder: string, opts: Opt[]) => {
    const current = params.get(key) ?? "";
    return (
      <Select value={current} onValueChange={(v) => update({ [key]: v === ALL ? undefined : v })}>
        <SelectTrigger aria-label={placeholder} className={cn("w-full sm:w-auto sm:max-w-[200px]", current && "border-primary/60 bg-primary/5 text-primary hover:bg-primary/10")}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value={ALL}>Hamısı</SelectItem>
          <SelectSeparator />
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  const active = ["q", "action", "entity", "user", "from", "to"].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <div className="relative w-full sm:w-64">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Təsvir, qeyd id-si, IP…" className="pl-9" />
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
        {select("action", "Əməliyyat", actions)}
        {select("entity", "Obyekt", entities)}
        {select("user", "İstifadəçi", users.map((u) => ({ value: u, label: `@${u}` })))}
      </div>
      <div className="flex w-full items-center gap-1.5 text-sm text-muted-foreground sm:w-auto">
        <DateInput aria-label="Başlanğıc tarixi" value={params.get("from") ?? ""} onChange={(v) => update({ from: v || undefined })} className="w-full sm:w-36" />
        –
        <DateInput aria-label="Son tarix" value={params.get("to") ?? ""} onChange={(v) => update({ to: v || undefined })} className="w-full sm:w-36" />
      </div>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            router.push(pathname);
          }}
        >
          <RotateCcwIcon /> Sıfırla
        </Button>
      )}
    </div>
  );
}
