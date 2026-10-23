"use client";

import type * as React from "react";
import { useMemo } from "react";
import { applyFilters, applyStaffingFilters, computeKpis, type DashboardDataset } from "@/lib/dashboard/filters";
import { cn } from "@/lib/utils";
import { CategoryChart, ChartEmpty, GenderChart, HiresChart, StructureChart } from "./charts";
import { EmployeeTable } from "./employee-table";
import { FilterBar } from "./filter-bar";
import { DashboardFilterProvider, useDashboardFilters } from "./filter-context";
import { KpiCards } from "./kpi-cards";

function Report({ data, aside }: { data: DashboardDataset; aside?: React.ReactNode }) {
  const { filters, active } = useDashboardFilters();
  // KPI-lar bütün filtrlər tətbiq olunmuş verilənlərdən
  const kpi = useMemo(() => computeKpis(applyFilters(data.rows, filters), applyStaffingFilters(data.staffing, filters)), [data, filters]);

  if (data.rows.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border bg-card py-16">
          <ChartEmpty filtered={false} />
        </div>
        {aside}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FilterBar rows={data.rows} departments={data.departments} />
      <KpiCards kpi={kpi} filtered={active} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <CategoryChart rows={data.rows} className="lg:col-span-5 xl:col-span-4" />
        <StructureChart rows={data.rows} departments={data.departments} className="lg:col-span-7 xl:col-span-8" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <HiresChart rows={data.rows} className="lg:col-span-7" />
        <GenderChart rows={data.rows} className="lg:col-span-5" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className={cn("min-w-0", aside ? "xl:col-span-8" : "xl:col-span-12")}>
          <EmployeeTable rows={data.rows} />
        </div>
        {aside && <div className="min-w-0 xl:col-span-4">{aside}</div>}
      </div>
    </div>
  );
}

/** Power BI üslubunda interaktiv hesabat: slicer-lər, cross-filter, drill-down. aside — cədvəlin yanında (məs. son idxallar) */
export function DashboardView({ data, aside }: { data: DashboardDataset; aside?: React.ReactNode }) {
  return (
    <DashboardFilterProvider>
      <Report data={data} aside={aside} />
    </DashboardFilterProvider>
  );
}
