import type { Cell, ReportColumn, ReportResult } from "@/lib/reports";
import { cn, formatAzn, formatNumber } from "@/lib/utils";

export function formatCell(col: ReportColumn, v: Cell): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return col.type === "money" ? formatAzn(v) : formatNumber(v, Number.isInteger(v) ? 0 : 2);
  return v;
}

/** Hesabat cədvəli — ekran (variant="screen") və çap (variant="print") üçün eyni struktur */
export function ReportTable({ result, variant = "screen" }: { result: ReportResult; variant?: "screen" | "print" }) {
  const print = variant === "print";
  const num = (c: ReportColumn) => c.type === "number" || c.type === "money";
  if (result.rows.length === 0)
    return <p className={cn("py-12 text-center text-sm", print ? "text-neutral-500" : "text-muted-foreground")}>Seçilmiş parametrlərə uyğun məlumat yoxdur</p>;
  return (
    <table className={cn("w-full", print ? "border-collapse text-[10.5px]" : "min-w-[720px] border-separate border-spacing-0 text-sm")}>
      <thead className={cn(!print && "sticky top-0 z-10")}>
        <tr>
          {result.columns.map((c) => (
            <th
              key={c.key}
              className={cn(
                "font-medium",
                print ? "border border-neutral-400 bg-neutral-100 px-1.5 py-1 font-semibold" : "h-10 border-b bg-muted px-3 text-xs whitespace-nowrap text-muted-foreground",
                num(c) ? "text-right" : "text-left",
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((r, i) => (
          <tr key={i} className={cn(print ? "break-inside-avoid" : "hover:bg-muted/50")}>
            {result.columns.map((c) => (
              <td
                key={c.key}
                className={cn(print ? "border border-neutral-400 px-1.5 py-0.5" : "border-b px-3 py-2", num(c) && "text-right whitespace-nowrap tabular-nums", r[c.key] == null && !print && "text-muted-foreground/70")}
              >
                {formatCell(c, r[c.key] ?? null)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {result.totals && (
        <tfoot>
          <tr className="font-semibold">
            {result.columns.map((c) => (
              <td key={c.key} className={cn(print ? "border border-neutral-400 bg-neutral-100 px-1.5 py-1" : "bg-muted/60 px-3 py-2.5", num(c) && "text-right whitespace-nowrap tabular-nums")}>
                {result.totals![c.key] === undefined ? "" : formatCell(c, result.totals![c.key] ?? null)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
