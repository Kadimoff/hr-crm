"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { NAV } from "./sidebar";

/** Topbar-da cari səhifənin konteksti: ASOİU HR CRM › Əməkdaşlar › Dosye */
export function Breadcrumbs() {
  const pathname = usePathname();
  const section = NAV.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  const crumbs: { label: string; href?: string }[] = [{ label: "ASOİU HR CRM", href: "/dashboard" }];
  if (section) {
    const nested = pathname !== section.href;
    crumbs.push({ label: section.label, href: nested ? section.href : undefined });
    if (nested && section.href === "/employees") {
      const [, , id, sub] = pathname.split("/");
      if (id === "new") crumbs.push({ label: "Yeni əməkdaş" });
      else if (sub === "edit") crumbs.push({ label: "Dosye", href: `/employees/${id}` }, { label: "Redaktə" });
      else crumbs.push({ label: "Dosye" });
    }
  }

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={c.label}>
            {i > 0 && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />}
            {c.href && !last ? (
              <Link href={c.href} className="truncate text-muted-foreground transition-colors hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span aria-current={last ? "page" : undefined} className="truncate font-medium">
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
