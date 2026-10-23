"use client";

import { RotateCcwIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, DEGREES, FILTER_KEYS, FILTER_LABELS, GENDERS, type DashboardRow, type DepartmentOption, type FilterKey } from "@/lib/dashboard/filters";
import { cn } from "@/lib/utils";
import { useDashboardFilters } from "./filter-context";

const ALL = "__all__";

interface Option {
  value: string;
  label: string;
  depth?: number;
}

function Slicer({ k, options, placeholder }: { k: FilterKey; options: Option[]; placeholder: string }) {
  const { filters, set } = useDashboardFilters();
  const current = filters[k];
  return (
    <Select value={current ?? ""} onValueChange={(v) => set(k, v === ALL ? undefined : v)}>
      <SelectTrigger aria-label={FILTER_LABELS[k]} title={FILTER_LABELS[k]} className={cn("w-full sm:w-auto sm:max-w-[240px]", current && "border-primary/60 bg-primary/5 text-primary hover:bg-primary/10")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[min(28rem,calc(100vw-2rem))]">
        <SelectItem value={ALL}>Hamısı</SelectItem>
        <SelectSeparator />
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} style={o.depth ? { paddingLeft: `${0.5 + o.depth * 0.9}rem` } : undefined}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Slicer-lər (dropdown) + aktiv filtr çipləri; qrafik klikləri ilə eyni state-i istifadə edir */
export function FilterBar({ rows, departments }: { rows: DashboardRow[]; departments: DepartmentOption[] }) {
  const { filters, set, reset, active } = useDashboardFilters();

  // Struktur ağacı: valideyndən sonra övladlar, səviyyəyə görə girinti
  const deptOptions = useMemo(() => {
    const ids = new Set(departments.map((d) => d.id));
    const kids = new Map<string | null, DepartmentOption[]>();
    for (const d of departments) {
      const p = d.parentId && ids.has(d.parentId) ? d.parentId : null;
      kids.set(p, [...(kids.get(p) ?? []), d]);
    }
    const out: Option[] = [];
    const walk = (p: string | null, depth: number) => {
      for (const d of (kids.get(p) ?? []).sort((a, b) => a.name.localeCompare(b.name, "az"))) {
        out.push({ value: d.id, label: d.name, depth });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [departments]);

  // Məlumatdakı illər + qrafikin 10 illik pəncərəsi + seçilmiş il (qrafikdə klik edilən il dropdown-da da görünsün)
  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const all = new Set([...rows.map((r) => r.hireYear), ...Array.from({ length: 10 }, (_, i) => thisYear - i)]);
    if (Number(filters.year)) all.add(Number(filters.year));
    return [...all].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  }, [rows, filters.year]);
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? id;
  const chips = FILTER_KEYS.filter((k) => filters[k]).map((k) => ({ key: k, label: k === "department" ? deptName(filters[k]!) : filters[k]! }));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-xs">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <span className="col-span-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground sm:col-span-1 sm:mr-1">
          <SlidersHorizontalIcon className="size-3.5" /> Filtrlər
        </span>
        <div className="col-span-2 sm:col-span-1">
          <Slicer k="department" options={deptOptions} placeholder="Struktur" />
        </div>
        <Slicer k="category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} placeholder="Kateqoriya" />
        <Slicer k="year" options={years} placeholder="İl" />
        <Slicer k="gender" options={GENDERS.map((g) => ({ value: g, label: g }))} placeholder="Cins" />
        <Slicer k="degree" options={DEGREES.map((g) => ({ value: g, label: g }))} placeholder="Elmi dərəcə" />
        <span className="ml-auto hidden text-[11px] text-muted-foreground xl:inline">Qrafiklərə klik də filtr kimi işləyir</span>
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 text-xs text-muted-foreground">Aktiv filtrlər:</span>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => set(c.key, undefined)}
              className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pr-1.5 pl-2.5 text-xs text-primary transition-colors hover:bg-primary/15"
              aria-label={`${FILTER_LABELS[c.key]}: ${c.label} — götür`}
            >
              <span className="text-primary/70">{FILTER_LABELS[c.key]}:</span> {c.label}
              <XIcon className="size-3.5 opacity-70 group-hover:opacity-100" />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={reset} className="ml-auto h-7">
            <RotateCcwIcon /> Filtrləri sıfırla
          </Button>
        </div>
      )}
    </div>
  );
}
