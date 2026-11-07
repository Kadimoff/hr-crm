import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PositionCatalogForm } from "@/components/regulations/catalog-form";
import { CreateRegulationButton, RegulationStatusBadge } from "@/components/regulations/regulation-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { POSITION_CLASS_LABELS } from "@/lib/positions-catalog";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vəzifə" };

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.view");
  const { id } = await params;
  const p = await prisma.position.findUnique({ where: { id } });
  if (!p) notFound();
  const canEdit = can(user.role, "charter.edit");
  const [jds, units, emps] = await Promise.all([
    prisma.jobDescription.findMany({ where: { positionId: id }, orderBy: [{ departmentId: "asc" }, { version: "desc" }], include: { department: { select: { id: true, name: true } } } }),
    prisma.$queryRaw<{ departmentId: string; name: string; unitCount: number }[]>`
      SELECT DISTINCT ON (s."departmentId") s."departmentId", d.name, s."unitCount"::float8 AS "unitCount"
      FROM "StaffingUnit" s JOIN "Department" d ON d.id = s."departmentId"
      WHERE s."positionId" = ${id}
      ORDER BY s."departmentId", s."periodDate" DESC`,
    prisma.employment.groupBy({ by: ["departmentId"], where: { positionId: id, status: { not: "TERMINATED" }, person: { deletedAt: null } }, _count: { _all: true } }),
  ]);
  const empBy = new Map(emps.map((e) => [e.departmentId, e._count._all]));
  // Təlimatlar: ümumi (bütün bölmələr) və bölməyə xüsusi — hər qrupda versiyalar
  const groups = new Map<string, { label: string; departmentId: string | null; rows: typeof jds }>();
  groups.set("general", { label: "Ümumi (bütün bölmələr üçün)", departmentId: null, rows: [] });
  for (const j of jds) {
    const k = j.departmentId ?? "general";
    if (!groups.has(k)) groups.set(k, { label: j.department!.name, departmentId: j.departmentId, rows: [] });
    groups.get(k)!.rows.push(j);
  }
  return (
    <>
      <Link href="/positions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Vəzifə kataloqu
      </Link>
      <PageHeader title={p.name} description={`JobID ${p.code} · əsas məzuniyyət ${p.basicLeaveDays} gün${p.classCode ? ` · ${POSITION_CLASS_LABELS[p.classCode]}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Kataloq</CardTitle>
              <CardDescription>Təsnifat şəxsə deyil, vəzifənin əsas funksiyasına bağlanır (TZ §3); rəsmi statistik kateqoriya («Heyət») ayrıca saxlanılır</CardDescription>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <PositionCatalogForm id={p.id} jobFamily={p.jobFamily} classCode={p.classCode} gradeCode={p.gradeCode} classes={Object.entries(POSITION_CLASS_LABELS).map(([value, label]) => ({ value, label }))} />
              ) : (
                <dl className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Peşə ailəsi</dt>
                    <dd>{p.jobFamily ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Təsnifat</dt>
                    <dd>{p.classCode ? POSITION_CLASS_LABELS[p.classCode] : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Grade</dt>
                    <dd>{p.gradeCode ?? "—"}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Vəzifə təlimatları</CardTitle>
              <CardDescription>Bölməyə xüsusi təlimat varsa o, yoxdursa ümumi təlimat tətbiq olunur. Təsdiqlənəndə əməkdaşlara tanışlıq tapşırığı yaranır.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {[...groups.values()].map((g) => (
                <div key={g.departmentId ?? "general"} data-jd-group={g.departmentId ?? "general"}>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{g.label}</span>
                    {canEdit && !g.rows.some((r) => r.status === "QARALAMA" || r.status === "HUQUQI_REYDE") && (
                      <CreateRegulationButton kind="jd" positionId={p.id} departmentId={g.departmentId} label={g.rows.length ? "Yeni versiya (boş)" : "Yeni təlimat"} />
                    )}
                  </div>
                  {g.rows.length === 0 && <p className="text-sm text-muted-foreground">Təlimat yoxdur</p>}
                  <div className="flex flex-col gap-1.5">
                    {g.rows.map((j) => (
                      <Link key={j.id} href={`/positions/job-descriptions/${j.id}`} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                        <span className="font-medium">v{j.version}</span>
                        <RegulationStatusBadge status={j.status} />
                        <span className="min-w-0 flex-1 truncate">{j.title}</span>
                        <span className="text-xs text-muted-foreground">{formatAzDate(j.effectiveFrom)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Ştat mövqeləri</CardTitle>
            <CardDescription>Bu vəzifənin bölmələr üzrə ştatı və tutan əməkdaşlar</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {units.length === 0 && <p className="text-muted-foreground">Ştat cədvəlində yoxdur</p>}
            {units.map((u) => (
              <div key={u.departmentId} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                <span className="min-w-0 break-words">{u.name}</span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular-nums text-muted-foreground">
                    {empBy.get(u.departmentId) ?? 0} / {u.unitCount}
                  </span>
                  {canEdit && !groups.has(u.departmentId) && <CreateRegulationButton kind="jd" positionId={p.id} departmentId={u.departmentId} label="Xüsusi təlimat" />}
                </span>
              </div>
            ))}
            {canEdit && units.length > 0 && <p className="mt-2 text-xs text-muted-foreground">«Xüsusi təlimat» — yalnız həmin bölmədəki mövqe üçün (ümumi təlimatı əvəz edir).</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
