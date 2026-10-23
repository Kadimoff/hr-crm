"use client";

import { useMemo } from "react";
import { applyFilters, applyStaffingFilters, computeKpis, type DashboardDataset } from "@/lib/dashboard/filters";
import { CategoryChart, ChartEmpty, GenderChart, HiresChart, StructureChart } from "./charts";
import { EmployeeTable } from "./employee-table";
import { FilterBar } from "./filter-bar";
import { DashboardFilterProvider, useDashboardFilters } from "./filter-context";
import { KpiCards } from "./kpi-cards";

function Report({ data }: { data: DashboardDataset }) {
  const { filters, active } = useDashboardFilters();
  // KPI-lar bütün filtrlər tətbiq olunmuş verilənlərdən
  const kpi = useMemo(() => computeKpis(applyFilters(data.rows, filters), applyStaffingFilters(data.staffing, filters)), [data, filters]);

  if (data.rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card py-16">
        <ChartEmpty filtered={false} />
      </div>
    );
  }

  return (
    <>
      <FilterBar rows={data.rows} departments={data.departments} />
      <KpiCards kpi={kpi} filtered={active} />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HiresChart rows={data.rows} />
        <GenderChart rows={data.rows} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryChart rows={data.rows} />
        <StructureChart rows={data.rows} departments={data.departments} />
      </div>
      <EmployeeTable rows={data.rows} />
    </>
  );
}

/** Power BI üslubunda interaktiv hesabat: slicer-lər, cross-filter, drill-down */
export function DashboardView({ data }: { data: DashboardDataset }) {
  return (
    <DashboardFilterProvider>
      <Report data={data} />
    </DashboardFilterProvider>
  );
}
