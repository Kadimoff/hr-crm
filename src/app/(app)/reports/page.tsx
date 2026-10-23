import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ReportParams } from "@/components/reports/report-params";
import { ReportTable } from "@/components/reports/report-table";
import { Card } from "@/components/ui/card";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getReport, readReportParams, REPORTS } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hesabatlar" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("reports");
  const sp = await searchParams;
  const report = getReport(sp.r) ?? REPORTS[0]!;
  const result = await report.run(await departmentScope(user), readReportParams(sp));
  const now = new Date();
  const defaults = { from: `${now.getUTCFullYear()}-01-01`, to: now.toISOString().slice(0, 10) };

  return (
    <>
      <PageHeader
        title="Hesabatlar"
        description={user.role === "DEPT_HEAD" ? `${user.departmentName ?? "Bölmə"} və alt bölmələri üzrə` : "Ekranda baxış, Excel ixracı və çap — bütün ixrac və çaplar audit jurnalına yazılır"}
      />
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {REPORTS.map((r) => (
            <Link
              key={r.key}
              href={`/reports?r=${r.key}`}
              className={cn(
                "min-w-48 shrink-0 rounded-lg border px-3 py-2.5 transition-colors lg:min-w-0",
                r.key === report.key ? "border-primary/50 bg-accent" : "bg-card hover:bg-muted",
              )}
            >
              <div className={cn("text-sm font-medium", r.key === report.key && "text-primary")}>{r.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>
            </Link>
          ))}
        </nav>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-3">
            <div>
              <h2 className="text-sm font-semibold">{report.title}</h2>
              {result.note && <p className="mt-0.5 text-xs text-muted-foreground">{result.note}</p>}
            </div>
            <Suspense>
              <ReportParams reportKey={report.key} params={report.params} defaults={defaults} />
            </Suspense>
          </div>
          <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
            <ReportTable result={result} />
          </div>
        </Card>
      </div>
    </>
  );
}
