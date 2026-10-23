import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { RecentImports } from "@/components/dashboard/recent-imports";
import { PageHeader } from "@/components/layout/page-header";
import { can } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getDashboardDataset } from "@/lib/dashboard/data";
import { getRecentImports } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "İdarə paneli" };

/** Tədris ili sentyabrdan başlayır: 2025/2026 */
function academicYear(d = new Date()) {
  const y = d.getFullYear();
  return d.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const canImport = can(user.role, "import");
  const [data, recent] = await Promise.all([getDashboardDataset(await departmentScope(user)), canImport ? getRecentImports() : Promise.resolve([])]);
  return (
    <>
      <PageHeader
        title="İdarə paneli"
        badge={`${academicYear()} tədris ili`}
        description={
          user.role === "DEPT_HEAD"
            ? `${user.departmentName ?? "Bölmə"} və alt bölmələri · qrafiklərə klik edərək filtrləyin`
            : "Kadr tərkibi, ştat doluluğu və ƏH fondu · qrafiklərə klik edərək filtrləyin, seçim linkdə saxlanılır"
        }
      />
      <Suspense>
        <DashboardView data={data} aside={canImport && recent.length > 0 ? <RecentImports batches={recent} /> : undefined} />
      </Suspense>
    </>
  );
}
