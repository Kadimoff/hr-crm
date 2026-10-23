import type { AuditAction, Prisma } from "@prisma/client";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { AuditFilters } from "@/components/admin/audit-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { cn, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit jurnalı" };

const PAGE_SIZE = 50;

const ACTION_LABEL: Record<AuditAction, { label: string; variant: "success" | "warning" | "danger" | "outline" | "default" }> = {
  LOGIN: { label: "Giriş", variant: "outline" },
  LOGIN_FAILED: { label: "Uğursuz giriş", variant: "danger" },
  LOGOUT: { label: "Çıxış", variant: "outline" },
  CREATE: { label: "Əlavə", variant: "success" },
  UPDATE: { label: "Dəyişiklik", variant: "default" },
  DELETE: { label: "Silmə", variant: "danger" },
  RESTORE: { label: "Bərpa", variant: "warning" },
  IMPORT: { label: "İdxal", variant: "default" },
  EXPORT: { label: "İxrac", variant: "outline" },
  PRINT: { label: "Çap", variant: "outline" },
  PASSWORD_RESET: { label: "Şifrə", variant: "warning" },
};

const ENTITY_LABEL: Record<string, string> = { Person: "Əməkdaş", User: "İstifadəçi", ImportBatch: "İdxal", Session: "Sessiya", Report: "Hesabat" };

interface Search {
  q?: string;
  action?: string;
  entity?: string;
  user?: string;
  from?: string;
  to?: string;
  page?: string;
}

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** UPDATE: { sahə: [əvvəl, sonra] }; digərləri: snapshot obyekti */
function Changes({ changes }: { changes: Prisma.JsonValue }) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
  const entries = Object.entries(changes);
  if (entries.length === 0) return null;
  const isDiff = entries.every(([, v]) => Array.isArray(v) && v.length === 2);
  return (
    <details className="mt-1.5 text-xs">
      <summary className="cursor-pointer text-primary select-none">{isDiff ? `${entries.length} sahə dəyişib` : "Ətraflı"}</summary>
      <table className="mt-1.5 w-full">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="align-top">
              <td className="py-0.5 pr-3 font-mono whitespace-nowrap text-muted-foreground">{k}</td>
              {isDiff ? (
                <td className="py-0.5 break-all">
                  <span className="text-danger line-through decoration-danger/50">{fmt((v as unknown[])[0])}</span>
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  <span className="text-success">{fmt((v as unknown[])[1])}</span>
                </td>
              ) : (
                <td className="py-0.5 break-all">{fmt(v)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser("audit.view");
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const day = (s: string | undefined, end = false) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00"}+04:00`) : undefined);

  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action && sp.action in ACTION_LABEL ? { action: sp.action as AuditAction } : {}),
    ...(sp.entity ? { entity: sp.entity } : {}),
    ...(sp.user ? { username: sp.user } : {}),
    ...(sp.q ? { OR: [{ summary: { contains: sp.q, mode: "insensitive" } }, { entityId: sp.q }, { ip: sp.q }] } : {}),
    ...(sp.from || sp.to ? { createdAt: { ...(day(sp.from) ? { gte: day(sp.from) } : {}), ...(day(sp.to, true) ? { lte: day(sp.to, true) } : {}) } } : {}),
  };

  const [logs, total, usernames] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where: { username: { not: null } }, distinct: ["username"], select: { username: true }, orderBy: { username: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit jurnalı" description="Kim, nə vaxt, nəyi etdi — girişlər, əlavə, dəyişiklik, silmə, idxal, ixrac və çap. Jurnal dəyişdirilə bilməz." />
      <Card className="overflow-hidden">
        <AuditFilters
          users={usernames.map((u) => u.username!)}
          actions={Object.entries(ACTION_LABEL).map(([value, { label }]) => ({ value, label }))}
          entities={Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                <th className="w-36 px-3 py-2.5 font-medium">Vaxt</th>
                <th className="w-36 px-3 py-2.5 font-medium">İstifadəçi</th>
                <th className="w-32 px-3 py-2.5 font-medium">Əməliyyat</th>
                <th className="px-3 py-2.5 font-medium">Təsvir</th>
                <th className="w-28 px-3 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-16 text-center text-muted-foreground">
                    Seçilmiş filtrlərə uyğun qeyd yoxdur
                  </td>
                </tr>
              )}
              {logs.map((l) => {
                const a = ACTION_LABEL[l.action];
                return (
                  <tr key={l.id} className="border-b align-top last:border-0">
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatDateTime(l.createdAt)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{l.username ? `@${l.username}` : <span className="text-muted-foreground/70">—</span>}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={a.variant}>{a.label}</Badge>
                      <div className="mt-1 text-xs text-muted-foreground">{ENTITY_LABEL[l.entity] ?? l.entity}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {l.entity === "Person" && l.entityId ? (
                        <Link href={`/employees/${l.entityId}`} className="hover:text-primary hover:underline">
                          {l.summary}
                        </Link>
                      ) : (
                        l.summary
                      )}
                      <Changes changes={l.changes} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{l.ip ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
          </span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              səh. {page + 1} / {pages}
            </span>
            <Button variant="outline" size="icon" className={cn("size-8", page === 0 && "pointer-events-none opacity-50")} asChild>
              <Link href={href(page - 1)} aria-label="Əvvəlki səhifə" aria-disabled={page === 0}>
                <ChevronLeftIcon />
              </Link>
            </Button>
            <Button variant="outline" size="icon" className={cn("size-8", page + 1 >= pages && "pointer-events-none opacity-50")} asChild>
              <Link href={href(page + 1)} aria-label="Növbəti səhifə" aria-disabled={page + 1 >= pages}>
                <ChevronRightIcon />
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
