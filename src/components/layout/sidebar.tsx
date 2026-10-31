"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { UserRole } from "@prisma/client";
import {
  BriefcaseIcon,
  ChevronDownIcon,
  CrownIcon,
  DatabaseIcon,
  FileBarChartIcon,
  FlaskConicalIcon,
  FolderOpenIcon,
  GraduationCapIcon,
  HardDriveIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MenuIcon,
  NetworkIcon,
  ScrollTextIcon,
  ShieldIcon,
  UploadCloudIcon,
  UsersIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { can, type Permission } from "@/lib/auth/roles";
import { findUnit, PERSONNEL_CATEGORIES, PERSONNEL_HREF, type UnitNode } from "@/lib/personnel";
import type { SidebarSummary } from "@/lib/queries";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export const NAV: { href: string; label: string; description: string; group: string; icon: typeof UsersIcon; permission?: Permission }[] = [
  { href: "/dashboard", label: "İdarə paneli", description: "Ümumi icmal", group: "Analitika", icon: LayoutDashboardIcon },
  { href: "/employees", label: "Əməkdaşlar", description: "Fiziki şəxslər və dosye", group: "Analitika", icon: UsersIcon, permission: "employees.view" },
  { href: PERSONNEL_HREF, label: "Şəxsi iş", description: "Heyət və bölmələr üzrə", group: "Analitika", icon: FolderOpenIcon, permission: "employees.view" },
  { href: "/org-chart", label: "Struktur", description: "Struktur ağacı", group: "Analitika", icon: NetworkIcon },
  { href: "/reports", label: "Hesabatlar", description: "Çap və Excel ixracı", group: "Analitika", icon: FileBarChartIcon, permission: "reports" },
  { href: "/import", label: "İdxal mərkəzi", description: "Excel şablonları", group: "Məlumat", icon: UploadCloudIcon, permission: "import" },
  { href: "/admin/users", label: "İstifadəçilər", description: "Rollar və səlahiyyətlər", group: "İdarəetmə", icon: ShieldIcon, permission: "users.manage" },
  { href: "/admin/requests", label: "Sorğular", description: "Sənəd silmə sorğuları", group: "İdarəetmə", icon: InboxIcon, permission: "requests.manage" },
  { href: "/admin/audit", label: "Audit jurnalı", description: "Dəyişikliklərin tarixçəsi", group: "İdarəetmə", icon: ScrollTextIcon, permission: "audit.view" },
  { href: "/admin/database", label: "Verilənlər bazası", description: "Backup, bərpa, təmizləmə", group: "İdarəetmə", icon: HardDriveIcon, permission: "database.manage" },
];

const navFor = (role: UserRole) => NAV.filter((n) => !n.permission || can(role, n.permission));

const CATEGORY_ICONS: Record<(typeof PERSONNEL_CATEGORIES)[number]["slug"], typeof UsersIcon> = {
  akademik: GraduationCapIcon,
  inzibati: BriefcaseIcon,
  "tedris-komekci": FlaskConicalIcon,
  rehberlik: CrownIcon,
  texniki: WrenchIcon,
};

const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Açılıb-bağlanan alt siyahı */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SubLink({ href, active, className, children }: { href: string; active: boolean; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("relative flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors", active ? "text-white" : "hover:bg-sidebar-accent/80 hover:text-white", className)}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-blue-600 shadow-md shadow-blue-600/25" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
      {children}
    </Link>
  );
}

/** Alt siyahını açıb-bağlayan kiçik ox düyməsi */
function Toggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent/80 hover:text-white"
    >
      <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
    </button>
  );
}

/** Heyət bölməsinin struktur ağacı: vahidlər (fakültə, departament) və onların alt bölmələri */
function UnitTree({ baseHref, nodes, openNode, setOpenNode }: { baseHref: string; nodes: UnitNode[]; openNode?: string; setOpenNode: (id?: string) => void }) {
  const pathname = usePathname();
  return (
    <div className="my-0.5 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
      {nodes.map((n) => {
        const href = `${baseHref}/${n.id}`;
        const open = openNode === n.id;
        return (
          <div key={n.id}>
            <div className="flex items-center gap-0.5">
              <SubLink href={href} active={pathname === href} className="py-1.5 text-xs">
                <span className="relative leading-snug">{n.name}</span>
              </SubLink>
              {n.children.length > 0 && <Toggle open={open} onClick={() => setOpenNode(open ? undefined : n.id)} label={open ? "Alt bölmələri gizlət" : "Alt bölmələri göstər"} />}
            </div>
            {n.children.length > 0 && (
              <Collapse open={open}>
                <div className="my-0.5 ml-3 space-y-0.5 border-l border-sidebar-border pl-2">
                  {n.children.map((c) => {
                    const cHref = `${baseHref}/${c.id}`;
                    return (
                      <SubLink key={c.id} href={cHref} active={pathname === cHref} className="py-1.5 text-[11px]">
                        <span className="relative leading-snug">{c.name}</span>
                      </SubLink>
                    );
                  })}
                </div>
              </Collapse>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** «Şəxsi iş»: heyət bölmələri; akademik heyətin içində fakültələr və kafedralar, inzibati heyətin içində departamentlər */
function PersonnelNav({ label, description, icon: Icon, units }: { label: string; description: string; icon: typeof UsersIcon; units: SidebarSummary["units"] }) {
  const pathname = usePathname();
  const inSection = isUnder(pathname, PERSONNEL_HREF);
  // Cari səhifə: /personnel/<bölmə>/<vahid id>
  const [, , slug, unitId] = pathname.split("/");
  const current = PERSONNEL_CATEGORIES.find((c) => inSection && c.slug === slug);
  const currentNode = current?.units && unitId ? findUnit(units[current.units], unitId)?.node.id : undefined;
  const [open, setOpen] = useState(inSection);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(current ? { [current.slug]: true } : {});
  const [openNode, setOpenNode] = useState(currentNode);
  // Başqa yerdən bu bölməyə keçəndə menyu özü açılır
  useEffect(() => {
    if (inSection) setOpen(true);
    if (current) setOpenCats((v) => ({ ...v, [current.slug]: true }));
    if (currentNode) setOpenNode(currentNode);
  }, [inSection, current, currentNode]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent/80 hover:text-white", inSection && "text-white")}
      >
        <Icon className="size-4 shrink-0 text-blue-400" />
        <span className="flex-1">
          <span className="block">{label}</span>
          <span className="block text-[10px] text-sidebar-muted">{description}</span>
        </span>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-sidebar-muted transition-transform", open && "rotate-180")} />
      </button>
      <Collapse open={open}>
        <div className="mt-1 ml-5 space-y-0.5 border-l border-sidebar-border pl-2">
          {PERSONNEL_CATEGORIES.map((c) => {
            const href = `${PERSONNEL_HREF}/${c.slug}`;
            const CatIcon = CATEGORY_ICONS[c.slug];
            const nodes = c.units ? units[c.units] : [];
            const catOpen = !!openCats[c.slug];
            return (
              <div key={c.slug}>
                <div className="flex items-center gap-0.5">
                  <SubLink href={href} active={pathname === href}>
                    <CatIcon className={cn("relative size-3.5 shrink-0", pathname !== href && "text-blue-400")} />
                    <span className="relative truncate">{c.label}</span>
                  </SubLink>
                  {nodes.length > 0 && <Toggle open={catOpen} onClick={() => setOpenCats((v) => ({ ...v, [c.slug]: !catOpen }))} label={catOpen ? "Bölmələri gizlət" : "Bölmələri göstər"} />}
                </div>
                {nodes.length > 0 && (
                  <Collapse open={catOpen}>
                    <UnitTree baseHref={href} nodes={nodes} openNode={openNode} setOpenNode={setOpenNode} />
                  </Collapse>
                )}
              </div>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
}

const pct = (v: number) => `${formatNumber(v * 100, 1)}%`;

function SidebarContent({ role, summary, onClose }: { role: UserRole; summary: SidebarSummary; onClose?: () => void }) {
  const pathname = usePathname();
  const items = navFor(role);
  const groups = [...new Set(items.map((n) => n.group))];
  const fillRate = summary.totalUnits > 0 ? summary.filledUnits / summary.totalUnits : null;

  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
      <div className="flex items-center justify-between border-b border-sidebar-border p-5">
        <Link href="/dashboard" className="flex min-w-0 flex-col gap-2" aria-label="ASOİU HR CRM — İdarə paneli">
          {/* Tünd fonda logonun ağ versiyası */}
          <img src="/logo-white.png" alt="ASOİU — Azərbaycan Dövlət Neft və Sənaye Universiteti" width={1000} height={347} className="h-12 w-auto self-start" />
          <div className="text-[11px] font-medium text-blue-400">HR CRM · Kadr və əməkhaqqı sistemi</div>
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
                if (href === PERSONNEL_HREF) return <PersonnelNav key={href} label={label} description={description} icon={Icon} units={summary.units} />;
                const active = isUnder(pathname, href);
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
                    <span className="relative flex-1">
                      <span className="block">{label}</span>
                      <span className={cn("block text-[10px]", active ? "text-white/80" : "text-sidebar-muted")}>{description}</span>
                    </span>
                    {href === "/admin/requests" && summary.pendingRequests > 0 && (
                      <span className="relative rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums" title="Gözləyən sorğular">
                        {summary.pendingRequests}
                      </span>
                    )}
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
