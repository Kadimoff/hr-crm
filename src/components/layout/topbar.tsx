import { FileSpreadsheetIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { can } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import type { SidebarSummary } from "@/lib/queries";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./sidebar";
import { TopbarSearch } from "./topbar-search";
import { UserMenu } from "./user-menu";

export function Topbar({ user, summary }: { user: CurrentUser; summary: SidebarSummary }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md lg:px-6">
      <MobileNav role={user.role} summary={summary} />
      <Breadcrumbs units={summary.units} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {can(user.role, "employees.view") && <TopbarSearch />}
        {can(user.role, "import") && (
          <Link
            href="/import"
            aria-label="Excel idxal"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 pointer-coarse:h-10 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
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
