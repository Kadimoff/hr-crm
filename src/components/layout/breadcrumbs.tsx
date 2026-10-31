"use client";

import { ChevronRightIcon, HomeIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { findUnit, PERSONNEL_HREF, personnelCategory } from "@/lib/personnel";
import type { SidebarSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { NAV } from "./sidebar";

/** Topbar-da cari səhifənin konteksti: (ana səhifə ikonu) › Əməkdaşlar › Dosye */
export function Breadcrumbs({ units }: { units: SidebarSummary["units"] }) {
  const pathname = usePathname();
  const section = NAV.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  const crumbs: { label: string; href?: string }[] = [{ label: "ASOİU HR CRM", href: "/dashboard" }];
  if (section) {
    const nested = pathname !== section.href;
    if (section.href === PERSONNEL_HREF) {
      // Şəxsi iş › Akademik heyət › Fakültə › Kafedra
      const [, , slug, unitId] = pathname.split("/");
      const category = slug ? personnelCategory(slug) : undefined;
      crumbs.push({ label: section.label });
      if (category) {
        const base = `${PERSONNEL_HREF}/${category.slug}`;
        crumbs.push({ label: category.label, href: unitId ? base : undefined });
        const unit = category.units && unitId ? findUnit(units[category.units], unitId) : undefined;
        if (unit) crumbs.push({ label: unit.node.name, href: unit.child ? `${base}/${unit.node.id}` : undefined });
        if (unit?.child) crumbs.push({ label: unit.child.name });
      }
    } else crumbs.push({ label: section.label, href: nested ? section.href : undefined });
    if (nested && section.href === "/employees") {
      const [, , id, sub] = pathname.split("/");
      if (id === "new") crumbs.push({ label: "Yeni əməkdaş" });
      else if (sub === "edit") crumbs.push({ label: "Dosye", href: `/employees/${id}` }, { label: "Redaktə" });
      else crumbs.push({ label: "Dosye" });
    }
  }

  // Uzun yolda aradakı halqalar «…» ilə yığılır (tam yol — üzərinə gəldikdə); dar ekranda valideyn halqası da gizlənir
  const collapsed = crumbs.length > 4;
  const shown: { label: string; href?: string; title?: string; wideOnly?: boolean }[] = collapsed
    ? [crumbs[0]!, { label: "…", title: crumbs.slice(1, -1).map((c) => c.label).join(" › ") }, { ...crumbs.at(-2)!, wideOnly: true }, crumbs.at(-1)!]
    : crumbs;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
      {shown.map((c, i) => {
        const last = i === shown.length - 1;
        const home = i === 0;
        return (
          <Fragment key={c.label}>
            {i > 0 && <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground/60", c.wideOnly && "max-xl:hidden")} />}
            {c.href && !last ? (
              <Link
                href={c.href}
                title={c.label}
                aria-label={home ? c.label : undefined}
                className={cn("text-muted-foreground transition-colors hover:text-foreground", home ? "shrink-0" : "max-w-44 shrink-[0.2] truncate", c.wideOnly && "max-xl:hidden")}
              >
                {home ? <HomeIcon className="size-4" /> : c.label}
              </Link>
            ) : (
              <span
                title={c.title ?? c.label}
                aria-current={last ? "page" : undefined}
                className={cn("truncate", last ? "font-medium" : c.title ? "shrink-0 text-muted-foreground" : "max-w-44 shrink-[0.2] text-muted-foreground", c.wideOnly && "max-xl:hidden")}
              >
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
