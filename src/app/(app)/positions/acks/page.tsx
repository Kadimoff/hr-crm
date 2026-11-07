import { ChevronLeftIcon, DownloadIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { AckButton } from "@/components/regulations/catalog-form";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { can } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getAcks, type AckRow } from "@/lib/positions-catalog";
import { formatNumber } from "@/lib/utils";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vəzifə təlimatı ilə tanış olmayanlar" };

export default async function AcksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("employees.view");
  const sp = await searchParams;
  const all = await getAcks({ pending: true, scope: await departmentScope(user) });
  const q = (sp.q ?? "").trim().toLocaleLowerCase("az");
  const rows = all.filter((a) => !q || `${a.fullName} ${a.code} ${a.department} ${a.position}`.toLocaleLowerCase("az").includes(q));
  const canEdit = can(user.role, "charter.edit");
  return (
    <>
      <Link href="/positions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Vəzifə kataloqu
      </Link>
      <PageHeader
        title="Vəzifə təlimatı ilə tanış olmayanlar"
        description="Qüvvədə olan təlimat üzrə açıq tapşırıqlar: yeni versiya, işə qəbul və köçürmədə avtomatik yaranır. Əməkdaş kağızda imzaladıqdan sonra tarixi qeyd edin."
        actions={
          <a href="/api/export/jd-acks" className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-muted" data-export-acks>
            <DownloadIcon className="size-4" /> Excel
          </a>
        }
      />
      <Card className="overflow-hidden">
        <form method="get" className="flex flex-wrap items-center gap-2 border-b p-3">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Ad, kod, bölmə, vəzifə" className="h-9 w-full max-w-xs rounded-lg border bg-background px-3 text-sm" aria-label="Axtarış" />
          <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">Axtar</button>
          <span className="ml-auto text-xs text-muted-foreground" data-acks-count>
            {formatNumber(rows.length)} tapşırıq
          </span>
        </form>
        <DataTable
          rows={rows}
          rowKey={(a) => a.id}
          empty="Bütün əməkdaşlar qüvvədə olan təlimatlarla tanışdır"
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
            { header: "Bölmə / vəzifə", minWidth: 220, cell: (a) => `${a.department} · ${a.position}` },
            {
              header: "Təlimat",
              minWidth: 200,
              cell: (a) => (
                <Link href={`/positions/job-descriptions/${a.jdId}`} className="text-primary hover:underline">
                  {a.jdTitle} · v{a.jdVersion}
                </Link>
              ),
            },
            { header: "Səbəb", cell: (a) => a.reason ?? "—", className: "whitespace-nowrap" },
            { header: "Tapşırıq tarixi", cell: (a) => formatAzDate(a.assignedAt), className: "whitespace-nowrap tabular-nums" },
            ...(canEdit ? [{ header: " ", cell: (a: AckRow) => <AckButton ids={[a.id]} /> }] : []),
          ]}
        />
      </Card>
    </>
  );
}
