import { DownloadIcon, NetworkIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { RegulationStatusBadge } from "@/components/regulations/regulation-view";
import { CancelChangeButton, ScheduleChangeForm } from "@/components/structure/change-form";
import { LinkTabs } from "@/components/structure/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { can } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { applyDueDepartmentChanges } from "@/lib/department-changes";
import { CHANGE_KIND_LABELS, DEPARTMENT_KIND_LABELS, levelLabel } from "@/lib/org-structure";
import { getCharterRegistry, getDepartmentChanges, getDepartmentRegistry, type ChangeRow } from "@/lib/structure-registry";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Struktur reyestri" };

const STATE: Record<ChangeRow["state"], { label: string; variant: "default" | "success" | "warning" | "danger" | "outline" }> = {
  applied: { label: "Tətbiq olunub", variant: "success" },
  planned: { label: "Planlaşdırılıb", variant: "warning" },
  waiting: { label: "Gözləyir (maneə var)", variant: "danger" },
  cancelled: { label: "Ləğv edilib", variant: "outline" },
};

export default async function StructurePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("employees.view");
  const sp = await searchParams;
  await applyDueDepartmentChanges(prisma).catch(() => null);
  const tab = sp.tab === "changes" || sp.tab === "charters" ? sp.tab : "units";
  const canEdit = can(user.role, "structure.edit");
  const [registry, changes, charters] = await Promise.all([
    getDepartmentRegistry(),
    tab === "changes" ? getDepartmentChanges({ state: sp.state }) : Promise.resolve([]),
    tab === "charters" ? getCharterRegistry({ status: sp.status }) : Promise.resolve([]),
  ]);
  const q = (sp.q ?? "").trim().toLocaleLowerCase("az");
  const units = registry.filter((d) => (sp.closed === "1" || !d.closed) && (!q || `${d.code} ${d.name}`.toLocaleLowerCase("az").includes(q)));
  const plannedCount = registry.reduce((s, d) => s + d.planned, 0);

  return (
    <>
      <PageHeader
        title="Struktur reyestri"
        description="Bölmələr (növ, sıra, kampus, büdcə mərkəzi), struktur dəyişikliklərinin tarixçəsi və planı, əsasnamələr"
        actions={
          <Link href="/org-chart" className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm hover:bg-muted">
            <NetworkIcon className="size-4" /> Xəritə
          </Link>
        }
      />
      <LinkTabs
        active={tab}
        tabs={[
          { key: "units", label: "Bölmələr", href: "/structure", count: registry.filter((d) => !d.closed).length },
          { key: "changes", label: "Dəyişikliklər", href: "/structure?tab=changes", count: plannedCount || undefined },
          { key: "charters", label: "Əsasnamələr", href: "/structure?tab=charters" },
        ]}
      />

      {tab === "units" && (
        <Card className="overflow-hidden">
          <form method="get" className="flex flex-wrap items-center gap-2 border-b p-3">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Kod və ya ad" className="h-9 w-full max-w-xs rounded-lg border bg-background px-3 text-sm" aria-label="Axtarış" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" name="closed" value="1" defaultChecked={sp.closed === "1"} /> bağlananlar da
            </label>
            <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">Göstər</button>
            <a href="/api/export/structure" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted" data-export-structure>
              <DownloadIcon className="size-4" /> Excel (idxal şablonu)
            </a>
          </form>
          <DataTable
            rows={units}
            rowKey={(d) => d.id}
            columns={[
              { header: "Kod", cell: (d) => <span className="font-mono text-xs">{d.code}</span>, className: "whitespace-nowrap" },
              {
                header: "Ad",
                minWidth: 260,
                cell: (d) => (
                  <div style={{ paddingLeft: (d.level - 1) * 12 }}>
                    <Link href={`/structure/${d.id}`} className="font-medium break-words hover:underline" data-dept-link={d.code}>
                      {d.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {d.closed && <Badge variant="danger">bağlanıb {formatAzDate(d.closedOn)}</Badge>}
                      {!d.closed && d.closedOn && <Badge variant="warning">bağlanır {formatAzDate(d.closedOn)}</Badge>}
                      {d.isGroup && <Badge variant="outline">ştatsız qrup</Badge>}
                      {d.isExternal && <Badge variant="outline">ayrıca hüquqi şəxs</Badge>}
                      {d.planned > 0 && <Badge variant="warning">{d.planned} planlı dəyişiklik</Badge>}
                    </div>
                  </div>
                ),
              },
              { header: "Növ", cell: (d) => (d.kind ? DEPARTMENT_KIND_LABELS[d.kind] : "—"), className: "whitespace-nowrap" },
              { header: "Səviyyə", cell: (d) => levelLabel(d.level), className: "whitespace-nowrap text-muted-foreground" },
              { header: "Sıra", cell: (d) => d.sortOrder ?? "—", className: "tabular-nums" },
              { header: "Rəhbər", minWidth: 160, cell: (d) => d.headPositionTitle ?? "—" },
              { header: "Kampus / büdcə", cell: (d) => [d.campus, d.budgetCenter].filter(Boolean).join(" · ") || "—" },
              { header: "Heyət", cell: (d) => d.activeEmployments, className: "tabular-nums text-right" },
              {
                header: "Əsasnamə",
                cell: (d) =>
                  d.charter ? (
                    <Link href={`/structure/charters/${d.charter.id}`} className="inline-flex items-center gap-1">
                      <RegulationStatusBadge status={d.charter.status} />
                      <span className="text-xs text-muted-foreground">v{d.charter.version}</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">yoxdur</span>
                  ),
              },
            ]}
          />
        </Card>
      )}

      {tab === "changes" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="min-w-0 overflow-hidden">
            <div className="flex flex-wrap gap-2 border-b p-3 text-xs">
              {[
                ["", "Hamısı"],
                ["planned", "Planlaşdırılmış"],
                ["applied", "Tətbiq olunmuş"],
              ].map(([k, l]) => (
                <Link key={k} href={`/structure?tab=changes${k ? `&state=${k}` : ""}`} className={`rounded-full border px-3 py-1 ${(sp.state ?? "") === k ? "border-primary/50 bg-accent text-primary" : "hover:bg-muted"}`}>
                  {l}
                </Link>
              ))}
            </div>
            <DataTable
              rows={changes}
              rowKey={(c) => c.id}
              empty="Struktur dəyişikliyi qeydə alınmayıb"
              columns={[
                { header: "Qüvvəyə minir", cell: (c) => formatAzDate(c.effectiveDate), className: "whitespace-nowrap tabular-nums" },
                {
                  header: "Bölmə",
                  minWidth: 200,
                  cell: (c) => (
                    <Link href={`/structure/${c.departmentId}`} className="hover:underline">
                      <span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.department}
                    </Link>
                  ),
                },
                { header: "Növ", cell: (c) => CHANGE_KIND_LABELS[c.kind], className: "whitespace-nowrap" },
                { header: "Dəyişiklik", minWidth: 240, cell: (c) => <span className="break-words">{c.text}</span> },
                { header: "Əmr", cell: (c) => (c.orderNumber ? `№ ${c.orderNumber}${c.orderDate ? ` · ${formatAzDate(c.orderDate)}` : ""}` : "—"), className: "whitespace-nowrap" },
                {
                  header: "Vəziyyət",
                  cell: (c) => (
                    <Badge variant={STATE[c.state].variant} data-change-state={c.state}>
                      {STATE[c.state].label}
                    </Badge>
                  ),
                },
                { header: "Daxil edib", cell: (c) => <span className="text-xs text-muted-foreground">{c.by ?? "—"}</span> },
                ...(canEdit
                  ? [{ header: " ", cell: (c: ChangeRow) => (c.state === "planned" || c.state === "waiting" ? <CancelChangeButton id={c.id} label={`${c.department}: ${c.text}`} /> : null) }]
                  : []),
              ]}
            />
          </Card>
          {canEdit && <ScheduleChangeForm departments={registry.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}`, level: d.level, closed: d.closed }))} />}
        </div>
      )}

      {tab === "charters" && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-2 border-b p-3 text-xs">
            {[
              ["", "Hamısı"],
              ["TESDIQLENIB", "Qüvvədə"],
              ["QARALAMA", "Qaralama"],
              ["HUQUQI_REYDE", "Hüquqi rəydə"],
              ["QUVVEDEN_DUSUB", "Qüvvədən düşüb"],
            ].map(([k, l]) => (
              <Link key={k} href={`/structure?tab=charters${k ? `&status=${k}` : ""}`} className={`rounded-full border px-3 py-1 ${(sp.status ?? "") === k ? "border-primary/50 bg-accent text-primary" : "hover:bg-muted"}`}>
                {l}
              </Link>
            ))}
            <span className="ml-auto text-muted-foreground">Yeni əsasnamə — bölmənin səhifəsindən</span>
          </div>
          <DataTable
            rows={charters}
            rowKey={(c) => c.id}
            empty="Əsasnamə yoxdur — bölmənin səhifəsində «Yeni əsasnamə»"
            columns={[
              {
                header: "Bölmə",
                minWidth: 220,
                cell: (c) => (
                  <Link href={`/structure/${c.departmentId}`} className="hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.department}
                  </Link>
                ),
              },
              {
                header: "Əsasnamə",
                minWidth: 220,
                cell: (c) => (
                  <Link href={`/structure/charters/${c.id}`} className="font-medium hover:underline" data-charter-link>
                    {c.title}
                  </Link>
                ),
              },
              { header: "Versiya", cell: (c) => `v${c.version}`, className: "tabular-nums" },
              { header: "Status", cell: (c) => <RegulationStatusBadge status={c.status} /> },
              { header: "Təsdiq", cell: (c) => formatAzDate(c.approvedOn) || "—", className: "whitespace-nowrap tabular-nums" },
              {
                header: "Növbəti baxış",
                cell: (c) => (
                  <span className="whitespace-nowrap tabular-nums">
                    {formatAzDate(c.nextReviewOn) || "—"}
                    {c.review === "overdue" && (
                      <Badge variant="danger" className="ml-1">
                        gecikib
                      </Badge>
                    )}
                    {c.review === "soon" && (
                      <Badge variant="warning" className="ml-1">
                        yaxınlaşır
                      </Badge>
                    )}
                  </span>
                ),
              },
              { header: "İmzalı fayl", cell: (c) => (c.hasFile ? "var" : "—") },
            ]}
          />
        </Card>
      )}
    </>
  );
}
