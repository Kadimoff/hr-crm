import { PageHeader } from "@/components/layout/page-header";
import { OrgChart } from "@/components/org/org-chart";
import { can } from "@/lib/auth/roles";
import { hiddenSalaryPersonIds, lockedSalaryPersonIds } from "@/lib/auth/salary-access";
import { departmentScope } from "@/lib/auth/scope";
import { isSalaryPrivileged } from "@/lib/salary-privacy";
import { requireUser } from "@/lib/auth/session";
import { getOrgStaff, getOrgTree, getPersonFormOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Struktur" };

export default async function OrgChartPage() {
  const user = await requireUser();
  const canEdit = can(user.role, "employees.edit");
  const canEditStructure = can(user.role, "structure.edit");
  // Şöbə rəhbəri yalnız öz bölməsinin heyətini görür
  // Maaş məxfiliyi: gizlədilən okladlar null göndərilir, kilidli okladlar sürətli redaktədə dəyişdirilmir
  const [hidden, locked] = await Promise.all([hiddenSalaryPersonIds(user), lockedSalaryPersonIds(user)]);
  const [tree, staff, options] = await Promise.all([
    getOrgTree(),
    getOrgStaff(await departmentScope(user), { hidden, locked }),
    canEdit ? getPersonFormOptions() : Promise.resolve({ departments: [], positions: [] }),
  ]);
  return (
    <>
      <PageHeader title="Təşkilati struktur" description="Axtarış — ad, kod və ya FİN · bölməyə klik — alt bölmələr və heyət · əməkdaşa klik — məlumat və redaktə" />
      <OrgChart tree={tree} staff={staff} options={options} canEdit={canEdit} canEditStructure={canEditStructure} canMarkSalary={canEditStructure && isSalaryPrivileged(user)} />
    </>
  );
}
