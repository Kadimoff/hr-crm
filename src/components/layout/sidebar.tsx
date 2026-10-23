"use client";

import { motion } from "framer-motion";
import type { UserRole } from "@prisma/client";
import { BuildingIcon, FileBarChartIcon, LayoutDashboardIcon, NetworkIcon, ScrollTextIcon, ShieldIcon, UploadCloudIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type Permission } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export const NAV: { href: string; label: string; icon: typeof UsersIcon; permission?: Permission }[] = [
  { href: "/dashboard", label: "İdarə paneli", icon: LayoutDashboardIcon },
  { href: "/employees", label: "Əməkdaşlar", icon: UsersIcon, permission: "employees.view" },
  { href: "/org-chart", label: "Struktur", icon: NetworkIcon },
  { href: "/reports", label: "Hesabatlar", icon: FileBarChartIcon, permission: "reports" },
  { href: "/import", label: "İdxal mərkəzi", icon: UploadCloudIcon, permission: "import" },
  { href: "/admin/users", label: "İstifadəçilər", icon: ShieldIcon, permission: "users.manage" },
  { href: "/admin/audit", label: "Audit jurnalı", icon: ScrollTextIcon, permission: "audit.view" },
];

const navFor = (role: UserRole) => NAV.filter((n) => !n.permission || can(role, n.permission));

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BuildingIcon className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">ASOİU HR CRM</div>
          <div className="text-[11px] text-muted-foreground">Kadr və əməkhaqqı</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 p-3">
        {navFor(role).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon className={cn("relative size-4", active && "text-primary")} />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function MobileNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:hidden">
      {navFor(role).map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-label={label}
          className={cn("rounded-md p-2", pathname.startsWith(href) ? "bg-accent text-primary" : "text-muted-foreground")}
        >
          <Icon className="size-4" />
        </Link>
      ))}
    </nav>
  );
}
