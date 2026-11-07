import { CalendarSearchIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { OrgChart } from "@/components/org/org-chart";
import { DateInput } from "@/components/ui/date-input";
import { can } from "@/lib/auth/roles";
import { hiddenSalaryPersonIds, lockedSalaryPersonIds } from "@/lib/auth/salary-access";
import { departmentScope } from "@/lib/auth/scope";
import { isSalaryPrivileged } from "@/lib/salary-privacy";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { applyDueDepartmentChanges } from "@/lib/department-changes";
import { getOrgStaff, getOrgTree, getPersonFormOptions } from "@/lib/queries";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Struktur" };

const parseDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);

export default async function OrgChartPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // Tarixi çatmış planlaşdırılmış struktur dəyişiklikləri (worker da saatda bir tətbiq edir)
  await applyDueDepartmentChanges(prisma).catch(() => null);
  // «Tarixə görə struktur» (TZ M01-01): keçmiş və ya gələcək günün sxemi — yalnız baxış, heyət göstərilmir
  const asOf = parseDay(sp.asOf);
  const canEdit = !asOf && can(user.role, "employees.edit");
  const canEditStructure = !asOf && can(user.role, "structure.edit");
  // Şöbə rəhbəri yalnız öz bölməsinin heyətini görür
  // Maaş məxfiliyi: gizlədilən okladlar null göndərilir, kilidli okladlar sürətli redaktədə dəyişdirilmir
  const [hidden, locked] = await Promise.all([hiddenSalaryPersonIds(user), lockedSalaryPersonIds(user)]);
  const [tree, staff, options] = await Promise.all([
    getOrgTree(asOf ? { asOf } : {}),
    asOf ? Promise.resolve([]) : getOrgStaff(await departmentScope(user), { hidden, locked }),
    canEdit ? getPersonFormOptions() : Promise.resolve({ departments: [], positions: [] }),
  ]);
  return (
    <>
      <PageHeader
        title="Təşkilati struktur"
        description="Axtarış — ad, kod və ya FİN · bölməyə klik — alt bölmələr və heyət · əməkdaşa klik — məlumat və redaktə"
        actions={
          <form method="get" className="flex flex-wrap items-center gap-2" data-asof-form>
            <DateInput name="asOf" defaultValue={sp.asOf ?? ""} className="w-36" aria-label="Struktur hansı tarixə" />
            <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm hover:bg-muted">
              <CalendarSearchIcon className="size-4" /> Tarixə görə
            </button>
            {can(user.role, "employees.view") && (
              <Link href="/structure" className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm hover:bg-muted">
                <HistoryIcon className="size-4" /> Reyestr
              </Link>
            )}
          </form>
        }
      />
      {asOf && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm" data-asof-banner>
          <CalendarSearchIcon className="size-4 text-primary" />
          <span>
            <b>{formatAzDate(asOf)}</b> tarixinə struktur — tətbiq olunmuş və planlaşdırılmış dəyişikliklərdən bərpa olunub (yalnız baxış, heyət göstərilmir).
          </span>
          <Link href="/org-chart" className="ml-auto text-primary hover:underline">
            Cari struktur
          </Link>
        </div>
      )}
      <OrgChart tree={tree} staff={staff} options={options} canEdit={canEdit} canEditStructure={canEditStructure} canMarkSalary={canEditStructure && isSalaryPrivileged(user)} />
    </>
  );
}
