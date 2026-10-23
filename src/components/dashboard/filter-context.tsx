"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo } from "react";
import { FILTER_KEYS, filtersToQuery, hasFilters, parseFilters, type FilterKey, type Filters } from "@/lib/dashboard/filters";

interface FilterContextValue {
  filters: Filters;
  active: boolean;
  /** Eyni dəyərə ikinci klik filtri götürür */
  toggle: (key: FilterKey, value: string) => void;
  set: (key: FilterKey, value: string | undefined) => void;
  reset: () => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

/**
 * Filtrlərin yeganə mənbəyi URL-dir (?gender=Qadın&category=…): yeniləmədə və paylaşılan linkdə qorunur.
 * history.replaceState — Next.js useSearchParams-ı yeniləyir, amma serverə sorğu göndərmir.
 */
export function DashboardFilterProvider({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const filters = useMemo(() => parseFilters(new URLSearchParams(params)), [params]);

  const write = useCallback(
    (next: Filters) => {
      // Filtrlə əlaqəsi olmayan parametrlər (məs. səhifə) qorunur
      const q = new URLSearchParams(params);
      for (const k of FILTER_KEYS) q.delete(k);
      for (const [k, v] of new URLSearchParams(filtersToQuery(next))) q.set(k, v);
      const qs = q.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname],
  );

  const value = useMemo<FilterContextValue>(
    () => ({
      filters,
      active: hasFilters(filters),
      toggle: (key, v) => write({ ...filters, [key]: filters[key] === v ? undefined : v }),
      set: (key, v) => write({ ...filters, [key]: v || undefined }),
      reset: () => write({}),
    }),
    [filters, write],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useDashboardFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useDashboardFilters DashboardFilterProvider daxilində istifadə olunmalıdır");
  return ctx;
}
