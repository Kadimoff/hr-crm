import { FileSpreadsheetIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { can } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import type { SidebarSummary } from "@/lib/queries";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./sidebar";
import { UserMenu } from "./user-menu";

export function Topbar({ user, summary }: { user: CurrentUser; summary: SidebarSummary }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md lg:px-6">
      <MobileNav role={user.role} summary={summary} />
      <Breadcrumbs units={summary.units} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {can(user.role, "employees.view") && (
          // Əməkdaşlar siyahısında axtarış (?q=) — JS olmadan da işləyir
          <form action="/employees" role="search" className="relative hidden md:block">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              placeholder="Əməkdaş, kod, FİN axtar…"
              aria-label="Əməkdaş axtar"
              className="h-9 w-48 rounded-xl xl:w-64 border bg-muted pr-3 pl-8 text-xs placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </form>
        )}
        {can(user.role, "import") && (
          <Link
            href="/import"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
          >
            <FileSpreadsheetIcon className="size-3.5" />
            <span className="hidden sm:inline">Excel idxal</span>
          </Link>
        )}
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
