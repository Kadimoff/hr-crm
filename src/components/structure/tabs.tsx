import Link from "next/link";
import { cn } from "@/lib/utils";

/** Server tərəfli sadə tab-lar (?tab=…) — mobil üfüqi sürüşür */
export function LinkTabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0" data-link-tabs>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap", t.key === active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-active={t.key === active || undefined}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
