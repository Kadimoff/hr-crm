import { ArchiveIcon, PlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { EmployeeGrid } from "@/components/employee/employee-grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getEmployeeRows } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Əməkdaşlar" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ archived?: string; q?: string }> }) {
  const user = await requireUser("employees.view");
  const canEdit = can(user.role, "employees.edit");
  // Arxivi yalnız redaktə hüququ olanlar görür
  const params = await searchParams;
  const archived = canEdit && params.archived === "1";
  const rows = await getEmployeeRows(await departmentScope(user), { archived });
  const scopeNote = user.role === "DEPT_HEAD" ? ` · ${user.departmentName ?? "bölmə təyin edilməyib"} və alt bölmələri` : "";

  return (
    <>
      <PageHeader
        title={archived ? "Silinmiş əməkdaşlar (arxiv)" : "Əməkdaşlar"}
        description={archived ? `${rows.length} qeyd · dosyeni açıb bərpa edə bilərsiniz` : `${rows.length} fiziki şəxs${scopeNote} · axtarış, filtr, sütun seçimi və Excel ixracı`}
        actions={
          canEdit && (
            <>
              <Button variant="outline" asChild>
                {archived ? (
                  <Link href="/employees">
                    <UsersIcon /> Aktiv siyahı
                  </Link>
                ) : (
                  <Link href="/employees?archived=1">
                    <ArchiveIcon /> Arxiv
                  </Link>
                )}
              </Button>
              {!archived && (
                <Button asChild>
                  <Link href="/employees/new">
                    <PlusIcon /> Yeni əməkdaş
                  </Link>
                </Button>
              )}
            </>
          )
        }
      />
      {/* key: topbar-dan yeni axtarış gələndə cədvəl yenidən qurulur */}
      <EmployeeGrid key={params.q ?? ""} rows={rows} canAdd={canEdit && !archived} initialQuery={params.q?.slice(0, 100) ?? ""} />
    </>
  );
}
