"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, RotateCcwIcon, SparklesIcon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { listStagingRows, saveEditsAndRevalidate, type StagingRowDto } from "@/actions/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSheet } from "@/lib/validation/templates";
import type { FieldIssue, RawRow, SheetKey } from "@/lib/validation/types";
import { validateLocal } from "@/lib/validation/validate-row";

const ROW_HEIGHT = 36;

const TIER_LABEL: Record<FieldIssue["tier"], string> = { syntactic: "Sintaktik", semantic: "Semantik", reference: "İstinad" };

interface GridRow extends StagingRowDto {
  /** Redaktədən sonra: serverin istinad xətaları köhnəlib (yenidən yoxlanılacaq) */
  stale: boolean;
  dirty: Set<string>;
}

interface Props {
  batchId: string;
  sheetKey: SheetKey;
  disabled?: boolean;
  onSubmitted: () => void;
}

/**
 * Airtable/Excel üslubunda redaktə edilən xəta cədvəli.
 * - Xətalı xanalar qırmızı, xəbərdarlıqlar kəhrəba rəngdədir; üzərinə gələndə səbəb göstərilir
 * - Redaktə: iki dəfə klik, Enter və ya yazmağa başlamaq; Esc — ləğv; Tab / oxlar — naviqasiya
 * - Dəyişiklik dərhal brauzerdə (Zod) sintaktik + semantik yoxlanılır; istinadlar serverdə
 */
export function ErrorGrid({ batchId, sheetKey, disabled, onSubmitted }: Props) {
  const def = getSheet(sheetKey);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [submitting, startSubmit] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listStagingRows({ batchId, sheetKey, onlyProblems, pageSize: 2000 });
      setRows(res.rows.map((r) => ({ ...r, stale: false, dirty: new Set() })));
      setTotal(res.total);
    } catch (e) {
      toast.error("Sətirlər yüklənmədi", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [batchId, sheetKey, onlyProblems]);

  useEffect(() => {
    setActive(null);
    setEditing(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const updateCell = useCallback(
    (rowIndex: number, field: string, value: string) => {
      setRows((prev) => {
        const next = [...prev];
        const row = next[rowIndex];
        if (!row || row.data[field] === value) return prev;
        const data: RawRow = { ...row.data, [field]: value };
        const local = validateLocal(def, data);
        // Redaktə olunan sahənin istinad xətası köhnəlib — server yenidən yoxlayacaq
        const refs = row.errors.filter((i) => i.tier === "reference" && i.field !== field);
        next[rowIndex] = { ...row, data, errors: [...local, ...refs], stale: true, dirty: new Set([...row.dirty, field]) };
        return next;
      });
    },
    [def],
  );

  const applySuggestions = useCallback(
    (rowIndex?: number) => {
      const applied = rows
        .filter((_, i) => rowIndex === undefined || i === rowIndex)
        .reduce((n, r) => n + r.errors.filter((e) => e.suggestion !== undefined && e.field !== "*").length, 0);
      if (applied === 0) {
        toast.info("Tətbiq ediləcək təklif yoxdur");
        return;
      }
      setRows((prev) =>
        prev.map((row, i) => {
          if (rowIndex !== undefined && i !== rowIndex) return row;
          const fixes = row.errors.filter((e) => e.suggestion !== undefined && e.field !== "*");
          if (fixes.length === 0) return row;
          const data = { ...row.data };
          for (const f of fixes) data[f.field] = f.suggestion!;
          const local = validateLocal(def, data);
          return {
            ...row,
            data,
            errors: [...local, ...row.errors.filter((e) => e.tier === "reference" && e.suggestion === undefined)],
            stale: true,
            dirty: new Set([...row.dirty, ...fixes.map((f) => f.field)]),
          };
        }),
      );
      toast.success(`${applied} təklif tətbiq edildi`);
    },
    [def, rows],
  );

  const dirtyRows = rows.filter((r) => r.dirty.size > 0);
  const errorCount = rows.reduce((s, r) => s + r.errors.filter((e) => e.severity === "error").length, 0);
  const suggestionCount = rows.reduce((s, r) => s + r.errors.filter((e) => e.suggestion !== undefined).length, 0);
  const localBlocking = dirtyRows.filter((r) => r.errors.some((e) => e.severity === "error" && e.tier !== "reference")).length;

  const submit = () =>
    startSubmit(async () => {
      try {
        const res = await saveEditsAndRevalidate({ batchId, edits: dirtyRows.map((r) => ({ id: r.id, data: r.data })), commit: true });
        toast.success(`${res.updated} sətir göndərildi`, { description: "Yenidən yoxlanılır və etibarlı sətirlər bazaya yazılır" });
        onSubmitted();
      } catch (e) {
        toast.error("Göndərilmədi", { description: e instanceof Error ? e.message : String(e) });
      }
    });

  const columns = useMemo<ColumnDef<GridRow>[]>(
    () => [
      {
        id: "__row",
        header: "Sətir",
        size: 76,
        cell: ({ row }) => {
          const r = row.original;
          const hasError = r.errors.some((e) => e.severity === "error");
          return (
            <div className="flex items-center gap-1.5 px-2 font-mono text-xs text-muted-foreground tabular-nums">
              {hasError ? (
                <AlertCircleIcon className="size-3.5 text-danger" />
              ) : r.errors.length ? (
                <TriangleAlertIcon className="size-3.5 text-warning" />
              ) : (
                <CheckCircle2Icon className="size-3.5 text-success" />
              )}
              {r.rowNumber}
            </div>
          );
        },
      },
      ...def.columns.map<ColumnDef<GridRow>>((col) => ({
        id: col.key,
        header: () => (
          <span className="flex items-center gap-1" title={col.group ? `${col.group} → ${col.header}` : col.header}>
            {col.group && <span className="text-muted-foreground/70">{col.group} ·</span>}
            {col.header}
            {col.required && <span className="text-danger">*</span>}
          </span>
        ),
        size: col.width ? Math.max(col.width, col.group ? 150 : 0) : Math.max(120, Math.min(260, `${col.group ?? ""} ${col.header}`.length * 7 + 32)),
        cell: ({ row }) => row.original.data[col.key] ?? "",
      })),
    ],
    [def],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => r.id });
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1]!.end : 0;
  const fieldCols = def.columns;

  const startEdit = (r: number, c: number, initial?: string) => {
    if (disabled || c < 1) return;
    const field = fieldCols[c - 1]!.key;
    setEditing({ r, c, value: initial ?? rows[r]?.data[field] ?? "" });
  };

  const finishEdit = (save: boolean, move?: { dr: number; dc: number }) => {
    if (!editing) return;
    if (save) updateCell(editing.r, fieldCols[editing.c - 1]!.key, editing.value.trim());
    const next = move ? { r: clamp(editing.r + move.dr, 0, rows.length - 1), c: clamp(editing.c + move.dc, 1, fieldCols.length) } : { r: editing.r, c: editing.c };
    setEditing(null);
    setActive(next);
    virtualizer.scrollToIndex(next.r);
    scrollRef.current?.focus();
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    if (editing || !active) return;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    const mv = moves[e.key];
    if (mv) {
      e.preventDefault();
      const next = { r: clamp(active.r + mv[0], 0, rows.length - 1), c: clamp(active.c + mv[1], 1, fieldCols.length) };
      setActive(next);
      virtualizer.scrollToIndex(next.r);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(active.r, active.c);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      updateCell(active.r, fieldCols[active.c - 1]!.key, "");
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      startEdit(active.r, active.c, e.key);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={errorCount ? "danger" : "success"}>
          {errorCount ? <AlertCircleIcon /> : <CheckCircle2Icon />}
          {errorCount} xəta
        </Badge>
        <span className="text-xs text-muted-foreground">
          {rows.length} / {total} sətir göstərilir
        </span>
        <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
          <input type="checkbox" className="accent-[var(--primary)]" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Yalnız problemli sətirlər
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => applySuggestions()} disabled={disabled || suggestionCount === 0}>
            <WandSparklesIcon />
            Təklifləri tətbiq et {suggestionCount > 0 && <span className="tabular-nums">({suggestionCount})</span>}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={dirtyRows.length === 0 || submitting}>
            <RotateCcwIcon />
            Ləğv et
          </Button>
          <Button size="sm" onClick={submit} disabled={disabled || submitting || dirtyRows.length === 0}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Yenidən yoxla və yaz
            {dirtyRows.length > 0 && <span className="rounded bg-white/20 px-1.5 tabular-nums">{dirtyRows.length}</span>}
          </Button>
        </div>
      </div>
      {localBlocking > 0 && (
        <p className="text-xs text-warning">
          {localBlocking} redaktə edilmiş sətirdə hələ də format xətası var — göndərmək olar, lakin həmin sətirlər yazılmayacaq.
        </p>
      )}

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onGridKey}
        className="relative h-[min(60vh,560px)] overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        role="grid"
        aria-rowcount={rows.length}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yüklənir…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2Icon className="size-6 text-success" />
            Bu vərəqdə problemli sətir yoxdur
          </div>
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h, i) => (
                    <th
                      key={h.id}
                      style={{ width: h.getSize() }}
                      className={cn(
                        "h-9 border-b bg-muted px-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground",
                        i === 0 && "sticky left-0 z-30 border-r",
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {padTop > 0 && (
                <tr>
                  <td style={{ height: padTop }} />
                </tr>
              )}
              {items.map((vi) => {
                const row = table.getRowModel().rows[vi.index]!;
                const r = row.original;
                return (
                  <tr key={row.id} style={{ height: ROW_HEIGHT }} className="group">
                    {row.getVisibleCells().map((cell, c) => {
                      if (c === 0) {
                        return (
                          <td key={cell.id} className="sticky left-0 z-10 border-r border-b bg-card group-hover:bg-muted">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      }
                      const field = cell.column.id;
                      const issues = r.errors.filter((e) => e.field === field);
                      const hasError = issues.some((e) => e.severity === "error");
                      const isActive = active?.r === vi.index && active.c === c;
                      const isEditing = editing?.r === vi.index && editing.c === c;
                      const dirty = r.dirty.has(field);
                      const content = (
                        <td
                          key={cell.id}
                          onClick={() => setActive({ r: vi.index, c })}
                          onDoubleClick={() => startEdit(vi.index, c)}
                          className={cn(
                            "relative max-w-0 cursor-cell truncate border-b px-2 transition-colors",
                            hasError && "bg-danger-soft text-danger",
                            !hasError && issues.length > 0 && "bg-warning-soft",
                            dirty && !hasError && "bg-primary/5",
                            isActive && !isEditing && "outline-2 -outline-offset-2 outline-primary",
                          )}
                        >
                          {dirty && <span className="absolute top-0 right-0 size-0 border-t-[6px] border-l-[6px] border-t-primary border-l-transparent" />}
                          {isEditing ? (
                            <input
                              ref={editorRef}
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onBlur={() => finishEdit(true)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") finishEdit(true, { dr: 1, dc: 0 });
                                else if (e.key === "Tab") {
                                  e.preventDefault();
                                  finishEdit(true, { dr: 0, dc: e.shiftKey ? -1 : 1 });
                                } else if (e.key === "Escape") finishEdit(false);
                              }}
                              className="absolute inset-0 w-full bg-card px-2 text-foreground outline-2 -outline-offset-2 outline-primary"
                            />
                          ) : (
                            r.data[field] || <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                      );
                      if (issues.length === 0 || isEditing) return content;
                      return (
                        <Tooltip key={cell.id}>
                          <TooltipTrigger asChild>{content}</TooltipTrigger>
                          <TooltipContent side="bottom" align="start" className="space-y-1.5">
                            {issues.map((iss, k) => (
                              <div key={k} className="flex gap-2">
                                {iss.severity === "error" ? (
                                  <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-danger" />
                                ) : (
                                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                                )}
                                <div>
                                  <div>{iss.message}</div>
                                  <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
                                    {TIER_LABEL[iss.tier]}
                                    {iss.tier === "reference" && r.stale && " · yenidən yoxlanılacaq"}
                                  </div>
                                  {iss.suggestion !== undefined && !disabled && (
                                    <button
                                      type="button"
                                      className="mt-1 text-primary hover:underline"
                                      onClick={() => {
                                        updateCell(vi.index, field, iss.suggestion!);
                                      }}
                                    >
                                      Tətbiq et: <span className="font-mono">{iss.suggestion}</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </tr>
                );
              })}
              {padBottom > 0 && (
                <tr>
                  <td style={{ height: padBottom }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <RowLevelIssues rows={rows} />
      <p className="text-[11px] text-muted-foreground">
        İki dəfə klik və ya Enter — redaktə · Esc — ləğv · Tab / oxlar — naviqasiya · Delete — xananı təmizlə
      </p>
    </div>
  );
}

/** Konkret sütuna bağlı olmayan xətalar (məs. yazılma xətası) */
function RowLevelIssues({ rows }: { rows: GridRow[] }) {
  const list = rows.flatMap((r) => r.errors.filter((e) => e.field === "*").map((e) => ({ row: r.rowNumber, ...e })));
  if (list.length === 0) return null;
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger">
      {list.slice(0, 20).map((e, i) => (
        <div key={i}>
          Sətir {e.row}: {e.message}
        </div>
      ))}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
