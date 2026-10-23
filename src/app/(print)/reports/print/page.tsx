import { notFound } from "next/navigation";
import { PrintBar, Sheet } from "@/components/print/print-bar";
import { ReportTable } from "@/components/reports/report-table";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { APP_NAME, ORG_NAME, ORG_UNIT } from "@/lib/org";
import { getReport, readReportParams } from "@/lib/reports";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hesabat — çap" };

export default async function PrintReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("reports");
  const sp = await searchParams;
  const report = getReport(sp.r);
  if (!report) notFound();
  const result = await report.run(await departmentScope(user), readReportParams(sp));
  await audit({ user, action: "PRINT", entity: "Report", entityId: report.key, summary: `Hesabat çap üçün açıldı: ${report.title} (${result.rows.length} sətir)` });

  return (
    <>
      <PrintBar backHref={`/reports?${new URLSearchParams(sp as Record<string, string>)}`} />
      <Sheet>
        <header className="border-b-2 border-neutral-800 pb-3">
          <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
            {ORG_NAME} · {ORG_UNIT}
          </div>
          <h1 className="mt-1 text-[17px] font-bold">{report.title}</h1>
          <div className="mt-0.5 text-[11px] text-neutral-600">
            {user.role === "DEPT_HEAD" && `${user.departmentName ?? ""} və alt bölmələri · `}
            {result.note && `${result.note} · `}
            Tərtib edilib: {formatDateTime(new Date())}
          </div>
        </header>
        <div className="mt-4">
          <ReportTable result={result} variant="print" />
        </div>
        <footer className="mt-6 text-[10px] text-neutral-500">
          Çap edən: {user.fullName} (@{user.username}) · {APP_NAME}
        </footer>
      </Sheet>
    </>
  );
}
