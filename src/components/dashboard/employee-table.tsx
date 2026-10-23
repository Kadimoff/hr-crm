"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyFilters, filtersToQuery, type DashboardRow } from "@/lib/dashboard/filters";
import { formatIsoDate, formatNumber } from "@/lib/utils";
import { ChartEmpty } from "./charts";
import { useDashboardFilters } from "./filter-context";

const PAGE = 10;

/** Bütün filtrlər tətbiq olunmuş əməkdaş siyahısı; Excel ixracı server tərəfində eyni filtrlərlə */
export function EmployeeTable({ rows }: { rows: DashboardRow[] }) {
  const router = useRouter();
  const { filters, active } = useDashboardFilters();
  const list = useMemo(() => applyFilters(rows, filters).sort((a, b) => a.fullName.localeCompare(b.fullName, "az")), [rows, filters]);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filters]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const visible = list.slice(page * PAGE, (page + 1) * PAGE);
  const query = filtersToQuery(filters);

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <CardTitle>Əməkdaşlar</CardTitle>
          <CardDescription>
            {active ? "Seçilmiş filtrlərə uyğun" : "Bütün aktiv müqavilələr"} · {list.length} müqavilə
          </CardDescription>
        </div>
        {list.length > 0 ? (
          <Button size="sm" asChild>
            <a href={`/api/dashboard/export${query ? `?${query}` : ""}`} download>
              <DownloadIcon /> Excel-ə ixrac
            </a>
          </Button>
        ) : (
          <Button size="sm" disabled>
            <DownloadIcon /> Excel-ə ixrac
          </Button>
        )}
      </CardHeader>
      {list.length === 0 ? (
        <div className="py-10">
          <ChartEmpty />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Ad, soyad</th>
                  <th className="px-3 py-2.5 font-medium">Struktur</th>
                  <th className="px-3 py-2.5 font-medium">Vəzifə</th>
                  <th className="px-3 py-2.5 font-medium">Kateqoriya</th>
                  <th className="px-3 py-2.5 font-medium">Cins</th>
                  <th className="px-3 py-2.5 font-medium">İşə qəbul</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ştat vahidi</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.employmentId} onClick={() => router.push(`/employees/${r.personId}`)} className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/60">
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.fullName}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{r.code}</div>
                    </td>
                    <td className="px-3 py-2.5">{r.deptPath[r.deptPath.length - 1]?.name ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.position}</td>
                    <td className="px-3 py-2.5">{r.category}</td>
                    <td className="px-3 py-2.5">{r.gender}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatIsoDate(r.hireDate)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.unitShare, r.unitShare % 1 ? 2 : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, list.length)} / {list.length}
              </span>
              <Button variant="outline" size="icon" className="size-8" aria-label="Əvvəlki səhifə" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="icon" className="size-8" aria-label="Növbəti səhifə" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
