import { DownloadIcon, UserCheckIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { RegulationStatusBadge } from "@/components/regulations/regulation-view";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { requireUser } from "@/lib/auth/session";
import { getCatalog, POSITION_CLASS_LABELS } from "@/lib/positions-catalog";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vəzifə kataloqu" };

export default async function PositionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("employees.view");
  const sp = await searchParams;
  const all = await getCatalog();
  const q = (sp.q ?? "").trim().toLocaleLowerCase("az");
  const rows = all.filter(
    (p) =>
      (sp.closed === "1" || !p.closed) &&
      (!sp.class || (sp.class === "none" ? !p.classCode : p.classCode === sp.class)) &&
      (!sp.jd || (sp.jd === "none" ? !p.jd : sp.jd === "approved" ? p.jd?.status === "TESDIQLENIB" : p.jd && p.jd.status !== "TESDIQLENIB")) &&
      (!q || `${p.code} ${p.name} ${p.jobFamily ?? ""}`.toLocaleLowerCase("az").includes(q)),
  );
  const pending = all.reduce((s, p) => s + p.pendingAcks, 0);
  return (
    <>
      <PageHeader
        title="Vəzifə kataloqu"
        description="Vahid vəzifə adı (JobID), peşə ailəsi, təsnifat (A1/A2/N1–N5), grade və versiyalı vəzifə təlimatları — eyni vəzifə müxtəlif bölmələrdə ayrıca ştat mövqeləri ilə"
        actions={
          <Link href="/positions/acks" className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm hover:bg-muted" data-acks-link>
            <UserCheckIcon className="size-4" /> Tanış olmayanlar
            {pending > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-xs text-warning tabular-nums">{formatNumber(pending)}</span>}
          </Link>
        }
      />
      <Card className="overflow-hidden">
        <form method="get" className="flex flex-wrap items-center gap-2 border-b p-3">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Kod, ad, peşə ailəsi" className="h-9 w-full max-w-xs rounded-lg border bg-background px-3 text-sm" aria-label="Axtarış" />
          <select name="class" defaultValue={sp.class ?? ""} className="h-9 rounded-lg border bg-background px-2 text-sm" aria-label="Təsnifat">
            <option value="">Təsnifat: hamısı</option>
            <option value="none">— təsnif edilməyib</option>
            {Object.entries(POSITION_CLASS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select name="jd" defaultValue={sp.jd ?? ""} className="h-9 rounded-lg border bg-background px-2 text-sm" aria-label="Vəzifə təlimatı">
            <option value="">Təlimat: hamısı</option>
            <option value="approved">qüvvədə</option>
            <option value="draft">hazırlanır</option>
            <option value="none">yoxdur</option>
          </select>
          <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">Göstər</button>
          <span className="ml-auto text-xs text-muted-foreground">{formatNumber(rows.length)} vəzifə</span>
        </form>
        <DataTable
          rows={rows}
          rowKey={(p) => p.id}
          columns={[
            { header: "JobID", cell: (p) => <span className="font-mono text-xs">{p.code}</span>, className: "whitespace-nowrap" },
            {
              header: "Vəzifə",
              minWidth: 220,
              cell: (p) => (
                <Link href={`/positions/${p.id}`} className="font-medium hover:underline" data-position-link={p.code}>
                  {p.name}
                  {p.closed && <Badge variant="outline" className="ml-1">bağlanıb</Badge>}
                </Link>
              ),
            },
            { header: "Heyət", cell: (p) => p.staffCategory, className: "whitespace-nowrap text-muted-foreground" },
            { header: "Peşə ailəsi", cell: (p) => p.jobFamily ?? "—" },
            { header: "Təsnifat", cell: (p) => (p.classCode ? <Badge variant="outline">{p.classCode}</Badge> : "—") },
            { header: "Grade", cell: (p) => p.gradeCode ?? "—", className: "font-mono text-xs" },
            { header: "Bölmə", cell: (p) => p.departments, className: "tabular-nums text-right" },
            { header: "Əməkdaş", cell: (p) => p.employments, className: "tabular-nums text-right" },
            {
              header: "Vəzifə təlimatı",
              cell: (p) =>
                p.jd ? (
                  <Link href={`/positions/job-descriptions/${p.jd.id}`} className="inline-flex items-center gap-1">
                    <RegulationStatusBadge status={p.jd.status} /> <span className="text-xs text-muted-foreground">v{p.jd.version}</span>
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">yoxdur</span>
                ),
            },
            { header: "Tanış deyil", cell: (p) => (p.pendingAcks ? <Badge variant="warning">{p.pendingAcks}</Badge> : "—"), className: "text-right" },
          ]}
        />
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <DownloadIcon className="size-3.5" /> Vəzifələr idxal şablonu ilə yüklənir (1 Kadr Cədvəlləri → Vəzifələr); peşə ailəsi, təsnifat və grade vəzifənin səhifəsində doldurulur.
      </p>
    </>
  );
}
