import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { ContractEndEditor } from "@/components/employee/contract-end-editor";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { can } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getContractEnds, parseThresholds, type ContractEndRow } from "@/lib/contract-ends";
import { cn, formatNumber } from "@/lib/utils";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Müqavilə müddətləri" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("employees.view");
  const sp = await searchParams;
  const thresholds = parseThresholds(sp.d);
  const all = await getContractEnds(await departmentScope(user), thresholds);
  const bucket = sp.b === "overdue" ? "overdue" : sp.b && thresholds.includes(Number(sp.b)) ? Number(sp.b) : null;
  const rows = bucket === null ? all : all.filter((r) => r.bucket === bucket);
  const count = (b: number | "overdue") => all.filter((r) => r.bucket === b).length;
  const dq = sp.d ? `d=${encodeURIComponent(sp.d)}&` : "";
  const canEdit = can(user.role, "employees.edit");
  const chips: { key: string; label: string; n: number; tone: string }[] = [
    { key: "", label: "Hamısı", n: all.length, tone: "" },
    { key: "overdue", label: "Müddəti keçib", n: count("overdue"), tone: "text-danger" },
    ...[...thresholds].sort((a, b) => a - b).map((t) => ({ key: String(t), label: `≤ ${t} gün`, n: count(t), tone: t <= 30 ? "text-danger" : t <= 60 ? "text-warning" : "" })),
  ];
  return (
    <>
      <PageHeader
        title="Müqavilə müddətləri"
        description="Müddətli əmək müqavilələrinin sonu: 90/60/30 günlük bildiriş pillələri (dəyişdirilə bilər). Hər qeyddə məsul şəxs və sonrakı qərar."
        actions={
          <a href={`/api/export/contract-ends?d=${thresholds.join(",")}`} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-muted" data-export-contracts>
            <DownloadIcon className="size-4" /> Excel
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <Link
            key={c.key}
            href={`/contracts?${dq}${c.key ? `b=${c.key}` : ""}`}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", (sp.b ?? "") === c.key ? "border-primary/50 bg-accent font-medium text-primary" : "bg-card hover:bg-muted")}
            data-contract-bucket={c.key || "all"}
          >
            <span className={c.tone}>{c.label}</span>
            <span className="rounded-full bg-muted px-1.5 tabular-nums">{formatNumber(c.n)}</span>
          </Link>
        ))}
        <form method="get" className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Pillələr (gün):
          <input name="d" defaultValue={thresholds.join(",")} className="h-8 w-28 rounded-md border bg-background px-2 text-sm" aria-label="Bildiriş pillələri" />
          <button className="h-8 rounded-md border px-2 hover:bg-muted">Tətbiq et</button>
        </form>
      </div>
      <Card className="overflow-hidden">
        <DataTable
          rows={rows}
          rowKey={(r) => r.employmentId}
          empty="Yaxın tarixdə bitən müddətli müqavilə yoxdur"
          columns={[
            {
              header: "Əməkdaş",
              minWidth: 200,
              cell: (r: ContractEndRow) => (
                <Link href={`/employees/${r.personId}?tab=contract`} className="hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.fullName}
                </Link>
              ),
            },
            { header: "Bölmə / vəzifə", minWidth: 220, cell: (r) => `${r.department} · ${r.position}${r.isPrimary ? "" : " (əvəzçilik)"}` },
            { header: "Bitmə tarixi", cell: (r) => formatAzDate(r.endDate), className: "whitespace-nowrap tabular-nums" },
            {
              header: "Qalıb",
              cell: (r) => (
                <Badge variant={r.daysLeft < 0 || r.daysLeft <= 30 ? "danger" : r.daysLeft <= 60 ? "warning" : "outline"} data-days-left={r.daysLeft}>
                  {r.daysLeft < 0 ? `${-r.daysLeft} gün keçib` : `${r.daysLeft} gün`}
                </Badge>
              ),
            },
            { header: "Məsul / qərar", minWidth: 240, cell: (r) => <ContractEndEditor employmentId={r.employmentId} owner={r.owner} decision={r.decision} canEdit={canEdit} /> },
          ]}
        />
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Sınaq müddətinin sonu üçün 30/15/5 günlük bildirişlər sınaq müddəti sahəsi əlavə olunduqdan sonra (B mərhələsi).</p>
    </>
  );
}
