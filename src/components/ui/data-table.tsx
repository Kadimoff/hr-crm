import type * as React from "react";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  header: string;
  cell: (r: T) => React.ReactNode;
  className?: string;
  /** Mətn sütununun minimal eni (px) — dar telefonda sözlər bir-bir alt sətrə düşməsin */
  minWidth?: number;
}

/** Sadə server cədvəli: telefonda üfüqi sürüşür (səhifə şaquli), boş olanda izah */
export function DataTable<T>({ rows, columns, empty = "Məlumat yoxdur", rowKey, className }: { rows: T[]; columns: DataColumn<T>[]; empty?: string; rowKey: (r: T) => string; className?: string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} style={c.minWidth ? { minWidth: c.minWidth } : undefined} className={cn("h-10 border-b bg-muted px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-muted/40">
              {columns.map((c) => (
                <td key={c.header} className={cn("border-b px-3 py-2.5 align-top", c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
