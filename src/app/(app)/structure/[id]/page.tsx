import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CreateRegulationButton, RegulationStatusBadge } from "@/components/regulations/regulation-view";
import { CancelChangeButton, ScheduleChangeForm } from "@/components/structure/change-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { can } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { closeImpact } from "@/lib/department-changes";
import { CHANGE_KIND_LABELS, closeBlockers, DEPARTMENT_KIND_LABELS, effectiveKind, levelLabel } from "@/lib/org-structure";
import { getDepartmentChanges, getDepartmentRegistry, type ChangeRow } from "@/lib/structure-registry";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Struktur bölməsi" };

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.view");
  const { id } = await params;
  const d = await prisma.department.findUnique({ where: { id }, include: { parent: { select: { id: true, name: true, code: true } }, children: { select: { id: true, name: true, code: true, closedOn: true } } } });
  if (!d) notFound();
  const canEdit = can(user.role, "structure.edit");
  const canCharter = can(user.role, "charter.edit");
  const [charters, changes, impact, registry, positions] = await Promise.all([
    prisma.departmentCharter.findMany({ where: { departmentId: id }, orderBy: { version: "desc" } }),
    getDepartmentChanges({ departmentId: id }),
    closeImpact(prisma, id),
    canEdit ? getDepartmentRegistry() : Promise.resolve([]),
    prisma.employment.groupBy({ by: ["positionId"], where: { departmentId: id, status: { not: "TERMINATED" }, person: { deletedAt: null } }, _count: { _all: true } }),
  ]);
  const posNames = new Map((await prisma.position.findMany({ where: { id: { in: positions.map((p) => p.positionId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const inForce = charters.find((c) => c.status === "TESDIQLENIB") ?? null;
  const kind = effectiveKind(d);
  const blockers = closeBlockers(impact);
  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{value || "—"}</dd>
    </div>
  );
  return (
    <>
      <Link href="/structure" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Struktur reyestri
      </Link>
      <PageHeader title={d.name} description={`${d.code} · ${levelLabel(d.level)}${kind ? ` · ${DEPARTMENT_KIND_LABELS[kind]}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Bölmə haqqında</CardTitle>
              <CardDescription>Məqsəd, funksiyalar, səlahiyyət və məsuliyyət qüvvədə olan əsasnamədən götürülür (TZ M01-02)</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
                {field("Üst bölmə", d.parent ? <Link href={`/structure/${d.parent.id}`} className="text-primary hover:underline">{d.parent.name}</Link> : "1-ci səviyyə")}
                {field("Rəhbərin vəzifəsi", d.headPositionTitle)}
                {field("Hesabat xətti", inForce?.reportingLine)}
                {field("Kampus", d.campus)}
                {field("Büdcə mərkəzi", d.budgetCenter)}
                {field("Sıra", d.sortOrder ?? "koda görə")}
                {field("Yaradılıb", formatAzDate(d.createdOn))}
                {field("Bağlanma", formatAzDate(d.closedOn))}
                {field(
                  "Xüsusiyyət",
                  [d.isGroup && "ştatsız qrup", d.isExternal && "ayrıca hüquqi şəxs", d.salaryRestricted && "maaşlar məxfi"].filter(Boolean).join(", "),
                )}
              </dl>
              {inForce && (
                <div className="mt-4 grid gap-3 border-t pt-4 text-sm">
                  {[
                    ["Məqsəd", inForce.purpose],
                    ["Funksiyalar", inForce.functions],
                    ["Səlahiyyətlər", inForce.authorities],
                    ["Məsuliyyət", inForce.responsibilities],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div className="text-xs font-medium text-muted-foreground">{l}</div>
                      <div className="mt-0.5 line-clamp-6 whitespace-pre-wrap">{v || "—"}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Əsasnamə</CardTitle>
                <CardDescription>
                  {inForce ? `Qüvvədədir: v${inForce.version}, ${formatAzDate(inForce.effectiveFrom)}${inForce.nextReviewOn ? ` · növbəti baxış ${formatAzDate(inForce.nextReviewOn)}` : ""}` : "Qüvvədə olan əsasnamə yoxdur"}
                </CardDescription>
              </div>
              {canCharter && !charters.some((c) => c.status === "QARALAMA" || c.status === "HUQUQI_REYDE") && (
                <CreateRegulationButton kind="charter" departmentId={d.id} label={inForce ? "Yeni versiya (boş)" : "Yeni əsasnamə"} />
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {charters.length === 0 && <p className="text-sm text-muted-foreground">Hələ əsasnamə hazırlanmayıb</p>}
              {charters.map((c) => (
                <Link key={c.id} href={`/structure/charters/${c.id}`} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" data-charter-version={c.version}>
                  <span className="font-medium">v{c.version}</span>
                  <RegulationStatusBadge status={c.status} />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="text-xs text-muted-foreground">{formatAzDate(c.approvedOn)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Struktur tarixçəsi</CardTitle>
            </CardHeader>
            <DataTable
              rows={changes}
              rowKey={(c) => c.id}
              empty="Dəyişiklik qeydə alınmayıb"
              columns={[
                { header: "Tarix", cell: (c) => formatAzDate(c.effectiveDate), className: "whitespace-nowrap tabular-nums" },
                { header: "Növ", cell: (c) => CHANGE_KIND_LABELS[c.kind], className: "whitespace-nowrap" },
                { header: "Dəyişiklik", minWidth: 220, cell: (c) => c.text },
                { header: "Əmr", cell: (c) => c.orderNumber ?? "—" },
                {
                  header: "Vəziyyət",
                  cell: (c) => <Badge variant={c.state === "applied" ? "success" : c.state === "cancelled" ? "outline" : "warning"}>{c.state === "applied" ? "tətbiq olunub" : c.state === "cancelled" ? "ləğv edilib" : c.state === "waiting" ? "gözləyir" : "planlı"}</Badge>,
                },
                ...(canEdit ? [{ header: " ", cell: (c: ChangeRow) => (c.state === "planned" || c.state === "waiting" ? <CancelChangeButton id={c.id} label={c.text} /> : null) }] : []),
              ]}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card data-dept-impact>
            <CardHeader>
              <CardTitle>Əlaqələr (bağlanmadan əvvəl)</CardTitle>
              <CardDescription>TZ M01-03: aktiv təyinat, vakansiya (ştat), sənəd və hesabların yeni strukturla əlaqəsi</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span>Aktiv təyinat</span>
                <b className="tabular-nums">{impact.activeEmployments}</b>
              </div>
              {positions.map((p) => (
                <div key={p.positionId} className="flex justify-between pl-3 text-xs text-muted-foreground">
                  <span className="truncate">{posNames.get(p.positionId)}</span>
                  <span className="tabular-nums">{p._count._all}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span>Bağlanmamış alt bölmə</span>
                <b className="tabular-nums">{impact.openChildren}</b>
              </div>
              <div className="flex justify-between">
                <span>Ştat cədvəli sətirləri</span>
                <b className="tabular-nums">{impact.staffingUnits}</b>
              </div>
              <div className="flex justify-between">
                <span>Əsasnamə / vəzifə təlimatı</span>
                <b className="tabular-nums">{impact.documents}</b>
              </div>
              <div className="flex justify-between">
                <span>Rəhbər hesabı</span>
                <b className="tabular-nums">{impact.headUsers}</b>
              </div>
              <p className={blockers.length ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{blockers.length ? blockers.join("; ") : "Bağlanmaya maneə yoxdur."}</p>
            </CardContent>
          </Card>
          {d.children.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Alt bölmələr</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {d.children.map((c) => (
                  <Link key={c.id} href={`/structure/${c.id}`} className="hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.name}
                    {c.closedOn && <Badge variant="outline" className="ml-1">bağlanıb</Badge>}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {canEdit && <ScheduleChangeForm departments={registry.map((x) => ({ id: x.id, label: `${x.code} — ${x.name}`, level: x.level, closed: x.closed }))} defaultDepartmentId={d.id} />}
        </div>
      </div>
    </>
  );
}
