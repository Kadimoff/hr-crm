import { notFound } from "next/navigation";
import { EmployeeGrid } from "@/components/employee/employee-grid";
import { PageHeader } from "@/components/layout/page-header";
import { can } from "@/lib/auth/roles";
import { departmentScope, departmentSubtree } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { findUnit, personnelCategory } from "@/lib/personnel";
import { getEmployeeRows, getUnitTree } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ category: string; unit?: string[] }>;

/** /personnel/<bölmə> və ya /personnel/<bölmə>/<menyudakı struktur vahidinin id-si> */
async function resolve(params: Params) {
  const { category: slug, unit: rest = [] } = await params;
  const category = personnelCategory(slug);
  if (!category || rest.length > 1 || (rest.length === 1 && !category.units)) return null;
  const unit = rest[0] && category.units ? findUnit(await getUnitTree(category.units), rest[0]) : undefined;
  if (rest[0] && !unit) return null;
  return { category, unit };
}

export async function generateMetadata({ params }: { params: Params }) {
  const r = await resolve(params);
  return { title: r ? (r.unit ? (r.unit.child ?? r.unit.node).name : r.category.label) : "Şəxsi iş" };
}

export default async function PersonnelPage({ params }: { params: Params }) {
  const user = await requireUser("employees.view");
  const r = await resolve(params);
  if (!r) notFound();
  const { category, unit } = r;
  const current = unit && (unit.child ?? unit.node);

  const rows = await getEmployeeRows(await departmentScope(user), {
    employment: { position: category.where, ...(current ? { departmentId: { in: await departmentSubtree(current.id) } } : {}) },
  });

  return (
    <>
      <PageHeader
        title={current?.name ?? category.label}
        badge={unit ? (unit.child ? unit.node.name : category.label) : undefined}
        description={`${rows.length} nəfər · ${category.description} · sətrə klikləyib şəxsi işi açın`}
      />
      <EmployeeGrid rows={rows} canAdd={can(user.role, "employees.edit")} />
    </>
  );
}
