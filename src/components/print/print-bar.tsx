"use client";

import { ChevronLeftIcon, PrinterIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Ekranda görünən idarə paneli (çapda gizlənir); açılan kimi çap pəncərəsini təklif edir */
export function PrintBar({ backHref, autoPrint = true }: { backHref: string; autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [autoPrint]);
  return (
    <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-2 px-4 print:hidden">
      <Button variant="outline" size="sm" asChild>
        <a href={backHref}>
          <ChevronLeftIcon /> Geri
        </a>
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        <PrinterIcon /> Çap et / PDF
      </Button>
    </div>
  );
}

/** A4 vərəq — tema asılı deyil, həmişə ağ fonda qara mətn */
export function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <article className="print-sheet mx-auto w-full max-w-[210mm] bg-white px-[14mm] py-[12mm] text-[12px] leading-snug text-neutral-900 shadow-lg print:max-w-none print:p-0 print:shadow-none">
      {children}
    </article>
  );
}

export function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid-page">
      <h2 className="mb-2 border-b border-neutral-400 pb-1 text-[13px] font-semibold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 border-b border-dotted border-neutral-300 pb-1">
          <dt className="w-[42%] shrink-0 text-neutral-500">{k}</dt>
          <dd className="min-w-0 break-words">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PrintTable({ head, rows, empty = "Məlumat yoxdur" }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="text-neutral-500">{empty}</p>;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} className="border border-neutral-400 bg-neutral-100 px-1.5 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="break-inside-avoid">
            {r.map((c, j) => (
              <td key={j} className="border border-neutral-400 px-1.5 py-1 align-top">
                {c === null || c === undefined || c === "" ? "—" : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
