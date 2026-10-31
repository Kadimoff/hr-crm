import { PageHeader } from "@/components/layout/page-header";
import { OrgChart } from "@/components/org/org-chart";
import { can } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getOrgStaff, getOrgTree, getPersonFormOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Struktur" };

export default async function OrgChartPage() {
  const user = await requireUser();
  const canEdit = can(user.role, "employees.edit");
  const canEditStructure = can(user.role, "structure.edit");
  // Şöbə rəhbəri yalnız öz bölməsinin heyətini görür
  const [tree, staff, options] = await Promise.all([
    getOrgTree(),
    getOrgStaff(await departmentScope(user)),
    canEdit ? getPersonFormOptions() : Promise.resolve({ departments: [], positions: [] }),
  ]);
  return (
    <>
      <PageHeader title="Təşkilati struktur" description="Əməkdaşı tapmaq üçün adını, kodunu və ya FİN-ini yazın · bölməyə klik — alt bölmələr və heyət açılır · əməkdaşa klik — məlumat və redaktə" />
      <OrgChart tree={tree} staff={staff} options={options} canEdit={canEdit} canEditStructure={canEditStructure} />
    </>
  );
}
