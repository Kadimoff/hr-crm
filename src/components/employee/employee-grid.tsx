"use client";

import {
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type CellContext,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  DownloadIcon,
  RotateCcwIcon,
  SearchIcon,
  SearchXIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EmployeeRow } from "@/lib/queries";
import { cn, formatAzn, formatIsoDate, initials } from "@/lib/utils";

const VISIBILITY_KEY = "ehr-employee-columns";
const PAGE_SIZES = [25, 50, 100] as const;
const ALL = "__all__";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  ACTIVE: { label: "Aktiv", variant: "success" },
  ON_LEAVE: { label: "Məzuniyyətdə", variant: "warning" },
  TERMINATED: { label: "Azad olunub", variant: "danger" },
};

/** Boş xana üçün vahid işarə */
const Empty = () => <span className="text-muted-foreground/70">—</span>;

/** Mətn sütunları: 2 sətrə qədər bükülür, tam mətn `title`-da */
function TextCell({ getValue }: CellContext<EmployeeRow, unknown>) {
  const v = getValue();
  if (v === null || v === undefined || v === "") return <Empty />;
  return (
    <span className="line-clamp-2 break-words" title={String(v)}>
      {String(v)}
    </span>
  );
}

function DateCell({ getValue }: CellContext<EmployeeRow, unknown>) {
  const v = getValue() as string | null;
  return v ? <span className="whitespace-nowrap tabular-nums">{formatIsoDate(v)}</span> : <Empty />;
}

const RIGHT_ALIGNED = new Set(["baseSalary"]);

// `size` — 1366px ekranda bütün standart sütunların sığdığı minimal en; geniş ekranda artıq yer mütənasib bölünür
const columns: ColumnDef<EmployeeRow>[] = [
  {
    id: "fullName",
    accessorKey: "fullName",
    header: "Əməkdaş",
    size: 180,
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary sm:flex">
          {initials(row.original.fullName)}
        </span>
        <div className="min-w-0">
          <div className="line-clamp-2 font-medium break-words" title={row.original.fullName}>
            {row.original.fullName}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">{row.original.code}</div>
        </div>
      </div>
    ),
  },
  { id: "position", accessorKey: "position", header: "Vəzifə", size: 128, filterFn: "equalsString" },
  { id: "department", accessorKey: "department", header: "Struktur bölmə", size: 144, filterFn: "equalsString" },
  { id: "staffCategory", accessorKey: "staffCategory", header: "Heyət", size: 96, filterFn: "equalsString" },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    size: 112,
    filterFn: "equalsString",
    cell: ({ getValue }) => {
      const s = STATUS[getValue<string>() ?? ""];
      return s ? <Badge variant={s.variant}>{s.label}</Badge> : <Empty />;
    },
  },
  { id: "hireDate", accessorKey: "hireDate", header: "İşə qəbul", size: 92, cell: DateCell },
  {
    id: "baseSalary",
    accessorKey: "baseSalary",
    header: "Oklad",
    size: 108,
    cell: ({ getValue }) => {
      const v = getValue<number | null>();
      return v === null ? <Empty /> : <span className="whitespace-nowrap tabular-nums">{formatAzn(v)}</span>;
    },
  },
  { id: "degree", accessorKey: "degree", header: "Elmi dərəcə", size: 104, filterFn: "equalsString" },
  { id: "title", accessorKey: "title", header: "Elmi ad", size: 92, filterFn: "equalsString" },
  { id: "gender", accessorFn: (r) => (r.gender === "MALE" ? "Kişi" : "Qadın"), header: "Cins", size: 72, filterFn: "equalsString" },
  { id: "birthDate", accessorKey: "birthDate", header: "Doğum tarixi", size: 104, cell: DateCell },
  {
    id: "fin",
    accessorKey: "fin",
    header: "FİN",
    size: 84,
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? <span className="font-mono text-xs">{v}</span> : <Empty />;
    },
  },
  { id: "phone", accessorKey: "phone", header: "Telefon", size: 132 },
  { id: "email", accessorKey: "email", header: "E-poçt", size: 180 },
  { id: "contracts", accessorKey: "contracts", header: "Müqavilə", size: 88 },
  { id: "createdBy", accessorKey: "createdBy", header: "Qeydiyyata alan", size: 120, cell: ({ getValue }) => (getValue() ? <span className="font-mono text-xs">@{getValue<string>()}</span> : <Empty />) },
];

const DEFAULT_HIDDEN: VisibilityState = { birthDate: false, fin: false, phone: false, email: false, contracts: false, gender: false, createdBy: false };
const FACETS = ["department", "staffCategory", "status", "degree"] as const;
const FACET_LABEL: Record<(typeof FACETS)[number], string> = { department: "Bölmə", staffCategory: "Heyət", status: "Status", degree: "Elmi dərəcə" };

export function EmployeeGrid({ rows, canAdd = false, initialQuery = "" }: { rows: EmployeeRow[]; canAdd?: boolean; initialQuery?: string }) {
  const router = useRouter();
  const [globalFilter, setGlobalFilter] = useState(initialQuery);
  const [sorting, setSorting] = useState<SortingState>([{ id: "fullName", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_HIDDEN);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZES[0] });
  const [scrolledX, setScrolledX] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sütun seçimi brauzerdə yadda saxlanılır
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VISIBILITY_KEY);
      // Yeni əlavə olunan sütunlar köhnə yadda saxlanmış seçimdə yoxdur — onlar üçün defolt tətbiq olunur
      if (saved) setColumnVisibility({ ...DEFAULT_HIDDEN, ...(JSON.parse(saved) as VisibilityState) });
    } catch {
      // localStorage əlçatan deyil
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(columnVisibility));
    } catch {
      // localStorage əlçatan deyil
    }
  }, [columnVisibility]);

  const table = useReactTable({
    data: rows,
    columns,
    defaultColumn: { cell: TextCell },
    state: { globalFilter, sorting, columnFilters, columnVisibility, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _id, value: string) => {
      const q = value.trim().toLocaleLowerCase("az");
      if (!q) return true;
      const r = row.original;
      return [r.fullName, r.code, r.fin, r.position, r.department, r.email].some((v) => v?.toLocaleLowerCase("az").includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Filtrlənmiş və sıralanmış bütün sətirlər (ixrac və say üçün) — səhifələmədən əvvəl
  const filteredRows = table.getPrePaginationRowModel().rows;
  const pageRows = table.getRowModel().rows;
  const filtered = columnFilters.length > 0 || globalFilter !== "";
  const totalSize = table.getTotalSize();
  const { pageIndex, pageSize } = pagination;
  const pageCount = Math.max(table.getPageCount(), 1);
  const from = filteredRows.length ? pageIndex * pageSize + 1 : 0;
  const to = Math.min((pageIndex + 1) * pageSize, filteredRows.length);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pageIndex, pageSize]);

  const resetFilters = () => {
    setColumnFilters([]);
    setGlobalFilter("");
  };

  const exportExcel = async () => {
    const res = await fetch("/api/export/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: filteredRows.map((r) => r.original.id), cols: table.getVisibleLeafColumns().map((c) => c.id) }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emekdaslar-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder="Ad, kod, FİN, vəzifə…" className="pl-9" />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          {FACETS.map((id) => {
            const col = table.getColumn(id)!;
            const values = [...col.getFacetedUniqueValues().keys()].filter((v): v is string => typeof v === "string" && v !== "").sort((a, b) => a.localeCompare(b, "az"));
            const current = col.getFilterValue() as string | undefined;
            return (
              <Select key={id} value={current ?? ""} onValueChange={(v) => col.setFilterValue(v === ALL ? undefined : v)}>
                <SelectTrigger
                  aria-label={FACET_LABEL[id]}
                  title={FACET_LABEL[id]}
                  className={cn("w-full sm:w-auto sm:max-w-[220px]", current && "border-primary/60 bg-primary/5 text-primary hover:bg-primary/10")}
                >
                  <SelectValue placeholder={FACET_LABEL[id]} />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={ALL}>Hamısı</SelectItem>
                  <SelectSeparator />
                  {values.map((v) => (
                    <SelectItem key={v} value={v}>
                      {id === "status" ? (STATUS[v]?.label ?? v) : v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
        </div>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcwIcon /> Sıfırla
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3Icon /> Sütunlar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Görünən sütunlar</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((c) => c.id !== "fullName")
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={exportExcel} disabled={filteredRows.length === 0}>
            <DownloadIcon /> Excel
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center text-sm text-muted-foreground">
          <UsersIcon className="size-8" />
          Əməkdaş yoxdur
          {canAdd && (
            <div className="flex gap-2">
              <Button asChild size="sm">
                <a href="/employees/new">Əl ilə əlavə et</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href="/import">Excel-dən idxal</a>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={(e) => setScrolledX(e.currentTarget.scrollLeft > 0)} className="overflow-auto md:max-h-[calc(100dvh-19rem)]">
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: totalSize }}>
              <colgroup>
                {table.getVisibleLeafColumns().map((c) => (
                  <col key={c.id} style={{ width: `${(c.getSize() / totalSize) * 100}%` }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-20">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h, i) => {
                      const sorted = h.column.getIsSorted();
                      const right = RIGHT_ALIGNED.has(h.column.id);
                      return (
                        <th
                          key={h.id}
                          className={cn(
                            "h-10 border-b bg-muted px-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-3 last:pr-3",
                            right && "pr-5 text-right",
                            i === 0 && "sticky left-0 z-10",
                            i === 0 && scrolledX && "shadow-[inset_-1px_0_0_var(--border),6px_0_8px_-6px_rgb(0_0_0/0.18)]",
                          )}
                        >
                          <button
                            type="button"
                            className={cn("inline-flex max-w-full items-center gap-1 hover:text-foreground", right && "flex-row-reverse")}
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                            {sorted === "asc" ? (
                              <ArrowUpIcon className="size-3 shrink-0" />
                            ) : sorted === "desc" ? (
                              <ArrowDownIcon className="size-3 shrink-0" />
                            ) : (
                              <ArrowUpDownIcon className="size-3 shrink-0 opacity-40" />
                            )}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} onClick={() => router.push(`/employees/${row.original.id}`)} className="group cursor-pointer">
                    {row.getVisibleCells().map((cell, i) => (
                      <td
                        key={cell.id}
                        className={cn(
                          "h-12 border-b bg-card px-2.5 py-1.5 align-middle transition-colors group-last:border-b-0 group-hover:bg-[color-mix(in_srgb,var(--muted)_70%,var(--card))] first:pl-3 last:pr-3",
                          RIGHT_ALIGNED.has(cell.column.id) && "pr-5 text-right",
                          i === 0 && "sticky left-0 z-[1]",
                          i === 0 && scrolledX && "shadow-[inset_-1px_0_0_var(--border),6px_0_8px_-6px_rgb(0_0_0/0.18)]",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                      ))}
                    </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 && (
            <div className="flex flex-col items-center gap-3 border-t px-4 py-16 text-center text-sm text-muted-foreground">
              <SearchXIcon className="size-8" />
              <div>
                <div className="font-medium text-foreground">Filtrə uyğun əməkdaş tapılmadı</div>
                <div className="mt-1 text-xs">Axtarış sözünü və ya filtrləri dəyişin</div>
              </div>
              <Button variant="outline" size="sm" onClick={resetFilters}>
                <RotateCcwIcon /> Sıfırla
              </Button>
            </div>
          )}

          {filteredRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {from}–{to} / {filteredRows.length}
                {filtered && ` · cəmi ${rows.length}`}
              </span>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline">Səhifədə</span>
                <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
                  <SelectTrigger aria-label="Səhifədəki sətir sayı" className="h-8 w-[72px] px-2.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="px-1 tabular-nums">
                  səh. {pageIndex + 1} / {pageCount}
                </span>
                <Button variant="outline" size="icon" className="size-8" aria-label="Əvvəlki səhifə" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                  <ChevronLeftIcon />
                </Button>
                <Button variant="outline" size="icon" className="size-8" aria-label="Növbəti səhifə" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
