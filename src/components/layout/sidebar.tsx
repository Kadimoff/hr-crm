"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { UserRole } from "@prisma/client";
import { Building2Icon, DatabaseIcon, FileBarChartIcon, HardDriveIcon, LayoutDashboardIcon, MenuIcon, NetworkIcon, ScrollTextIcon, ShieldIcon, UploadCloudIcon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { can, type Permission } from "@/lib/auth/roles";
import type { SidebarSummary } from "@/lib/queries";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export const NAV: { href: string; label: string; description: string; group: string; icon: typeof UsersIcon; permission?: Permission }[] = [
  { href: "/dashboard", label: "İdarə paneli", description: "Ümumi icmal", group: "Analitika", icon: LayoutDashboardIcon },
  { href: "/employees", label: "Əməkdaşlar", description: "Fiziki şəxslər və dosye", group: "Analitika", icon: UsersIcon, permission: "employees.view" },
  { href: "/org-chart", label: "Struktur", description: "Struktur ağacı", group: "Analitika", icon: NetworkIcon },
  { href: "/reports", label: "Hesabatlar", description: "Çap və Excel ixracı", group: "Analitika", icon: FileBarChartIcon, permission: "reports" },
  { href: "/import", label: "İdxal mərkəzi", description: "Excel şablonları", group: "Məlumat", icon: UploadCloudIcon, permission: "import" },
  { href: "/admin/users", label: "İstifadəçilər", description: "Rollar və səlahiyyətlər", group: "İdarəetmə", icon: ShieldIcon, permission: "users.manage" },
  { href: "/admin/audit", label: "Audit jurnalı", description: "Dəyişikliklərin tarixçəsi", group: "İdarəetmə", icon: ScrollTextIcon, permission: "audit.view" },
  { href: "/admin/database", label: "Verilənlər bazası", description: "Backup, bərpa, təmizləmə", group: "İdarəetmə", icon: HardDriveIcon, permission: "database.manage" },
];

const navFor = (role: UserRole) => NAV.filter((n) => !n.permission || can(role, n.permission));

const pct = (v: number) => `${formatNumber(v * 100, 1)}%`;

function SidebarContent({ role, summary, onClose }: { role: UserRole; summary: SidebarSummary; onClose?: () => void }) {
  const pathname = usePathname();
  const items = navFor(role);
  const groups = [...new Set(items.map((n) => n.group))];
  const fillRate = summary.totalUnits > 0 ? summary.filledUnits / summary.totalUnits : null;

  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
      <div className="flex items-center justify-between border-b border-sidebar-border p-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-blue-400/30 bg-gradient-to-br from-blue-600 to-indigo-800 text-white shadow-lg shadow-blue-600/30">
            <Building2Icon className="size-5" />
          </div>
          <div>
            <div className="text-sm leading-tight font-bold text-white">ASOİU HR CRM</div>
            <div className="mt-0.5 text-[11px] font-medium text-blue-400">Kadr və əməkhaqqı sistemi</div>
          </div>
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Menyunu bağla" className="p-1 text-sidebar-muted hover:text-white">
            <XIcon className="size-5" />
          </button>
        )}
      </div>

      {summary.lastImport && (
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar-accent/60 px-4 py-3 text-xs">
          <span className="flex items-center gap-1.5 text-sidebar-muted">
            <DatabaseIcon className="size-3.5 text-emerald-400" />
            Son idxal:
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-semibold tabular-nums",
              summary.lastImport.status === "FAILED"
                ? "border-red-500/30 bg-red-500/20 text-red-300"
                : summary.lastImport.status === "NEEDS_REVIEW"
                  ? "border-amber-500/30 bg-amber-500/20 text-amber-300"
                  : "border-emerald-500/30 bg-emerald-500/20 text-emerald-300",
            )}
          >
            {formatDateTime(summary.lastImport.createdAt)}
          </span>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {groups.map((group, gi) => (
          <Fragment key={group}>
            <div className={cn("px-3 pb-1 text-[10px] font-bold tracking-wider text-sidebar-muted uppercase", gi > 0 && "pt-3")}>{group}</div>
            {items
              .filter((n) => n.group === group)
              .map(({ href, label, description, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                      active ? "text-white" : "hover:bg-sidebar-accent/80 hover:text-white",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-xl bg-blue-600 shadow-md shadow-blue-600/25"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <Icon className={cn("relative size-4 shrink-0", !active && "text-blue-400")} />
                    <span className="relative">
                      <span className="block">{label}</span>
                      <span className={cn("block text-[10px]", active ? "text-white/80" : "text-sidebar-muted")}>{description}</span>
                    </span>
                  </Link>
                );
              })}
          </Fragment>
        ))}
      </nav>

      {fillRate !== null && (
        <div className="m-3 rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-white">Ştat doluluğu</span>
            <span className={cn("font-bold tabular-nums", fillRate > 1 ? "text-red-400" : "text-emerald-400")}>{pct(fillRate)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400" style={{ width: `${Math.min(100, fillRate * 100)}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-sidebar-muted tabular-nums">
            <span>{formatNumber(summary.filledUnits, 2)} faktiki</span>
            <span>{formatNumber(summary.totalUnits, 2)} ştat</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ role, summary }: { role: UserRole; summary: SidebarSummary }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <SidebarContent role={role} summary={summary} />
    </aside>
  );
}

/** Mobil: hamburger düyməsi + soldan açılan menyu */
export function MobileNav({ role, summary }: { role: UserRole; summary: SidebarSummary }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Menyu" className="rounded-lg bg-muted p-2 text-muted-foreground lg:hidden">
        <MenuIcon className="size-4" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-sidebar lg:hidden"
            >
              <SidebarContent role={role} summary={summary} onClose={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
