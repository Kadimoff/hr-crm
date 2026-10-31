import { ArchiveIcon, ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeDossier } from "@/components/employee/dossier";
import { PersonToolbar, SavedToast } from "@/components/employee/person-actions";
import { can, canDeleteDocumentsDirectly } from "@/lib/auth/roles";
import { canAccessPerson } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getDossier } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDossier(id);
  return { title: data?.person.fullName ?? "Əməkdaş" };
}

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("employees.view");
  const { id } = await params;
  const canEdit = can(user.role, "employees.edit");
  const data = await getDossier(id);
  // Arxivdəki qeydləri yalnız redaktə hüququ olanlar görür; şöbə rəhbəri yalnız öz bölməsini
  if (!data || (data.person.deletedAt && !canEdit) || !(data.person.deletedAt || (await canAccessPerson(user, id)))) notFound();
  const p = data.person;

  return (
    <>
      <Suspense>
        <SavedToast />
      </Suspense>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeftIcon className="size-4" /> Əməkdaşlar
        </Link>
        <PersonToolbar id={p.id} name={p.fullName} canEdit={canEdit} archived={!!p.deletedAt} />
      </div>
      {p.deletedAt && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <ArchiveIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>Bu əməkdaş silinib (arxivdədir).</b> {p.deletedBy ? `${p.deletedBy.fullName} (@${p.deletedBy.username})` : "Naməlum istifadəçi"} · {formatDateTime(p.deletedAt)}
          </div>
        </div>
      )}
      <EmployeeDossier data={data} canEdit={canEdit} canDelete={canDeleteDocumentsDirectly(user)} tab={(await searchParams).tab} />
      <p className="mt-6 text-xs text-muted-foreground">
        Qeydiyyata alan: {p.createdBy ? `${p.createdBy.fullName} (@${p.createdBy.username})` : "idxal / sistem"} · {formatDateTime(p.createdAt)}
        {p.updatedBy && ` — son dəyişiklik: ${p.updatedBy.fullName} (@${p.updatedBy.username}) · ${formatDateTime(p.updatedAt)}`}
      </p>
    </>
  );
}
