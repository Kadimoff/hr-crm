import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AckButton } from "@/components/regulations/catalog-form";
import { RegulationView } from "@/components/regulations/regulation-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { can, canApproveRegulations } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getAcks, type AckRow } from "@/lib/positions-catalog";
import { getRegulationDTO } from "@/lib/regulation-dto";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vəzifə təlimatı" };

export default async function JobDescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.view");
  const { id } = await params;
  const data = await getRegulationDTO("jd", id);
  if (!data) notFound();
  const canEdit = can(user.role, "charter.edit");
  const acks = await getAcks({ jobDescriptionId: id, scope: await departmentScope(user) });
  const pending = acks.filter((a) => !a.acknowledgedAt);
  return (
    <>
      <Link href={data.owner.href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> {data.owner.label}
      </Link>
      <PageHeader title={`Vəzifə təlimatı · v${data.version}`} description={data.owner.label} />
      <RegulationView data={data} canEdit={canEdit} canApprove={canApproveRegulations(user)} />
      {(data.status === "TESDIQLENIB" || data.status === "QUVVEDEN_DUSUB" || acks.length > 0) && (
        <Card className="mt-4 overflow-hidden" data-jd-acks>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Tanışlıq</CardTitle>
              <CardDescription>
                {acks.length - pending.length} / {acks.length} əməkdaş tanış olub. Yeni versiya təsdiqlənəndə əvvəlki tanışlıqlar silinmir — yeni tapşırıq yaranır.
              </CardDescription>
            </div>
            {canEdit && pending.length > 1 && <AckButton ids={pending.map((a) => a.id)} label={`Hamısını qeyd et (${pending.length})`} />}
          </CardHeader>
          <DataTable
            rows={acks}
            rowKey={(a) => a.id}
            empty="Tapşırıq yoxdur"
            columns={[
              {
                header: "Əməkdaş",
                minWidth: 200,
                cell: (a: AckRow) => (
                  <Link href={`/employees/${a.personId}`} className="hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.fullName}
                  </Link>
                ),
              },
              { header: "Bölmə", minWidth: 180, cell: (a) => a.department },
              { header: "Səbəb", cell: (a) => a.reason ?? "—", className: "whitespace-nowrap" },
              { header: "Tapşırıq", cell: (a) => formatAzDate(a.assignedAt), className: "whitespace-nowrap tabular-nums" },
              {
                header: "Tanış olub",
                cell: (a) => (a.acknowledgedAt ? <Badge variant="success">{formatAzDate(a.acknowledgedAt)}</Badge> : <Badge variant="warning">tanış deyil</Badge>),
              },
              { header: "Qeyd edən", cell: (a) => <span className="text-xs text-muted-foreground">{a.acknowledgedBy ?? "—"}</span> },
              ...(canEdit ? [{ header: " ", cell: (a: AckRow) => (a.acknowledgedAt ? <AckButton ids={[a.id]} undo /> : <AckButton ids={[a.id]} />) }] : []),
            ]}
          />
        </Card>
      )}
    </>
  );
}
