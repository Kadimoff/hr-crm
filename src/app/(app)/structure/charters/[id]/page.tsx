import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RegulationView } from "@/components/regulations/regulation-view";
import { can, canApproveRegulations } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getRegulationDTO } from "@/lib/regulation-dto";

export const dynamic = "force-dynamic";
export const metadata = { title: "Əsasnamə" };

export default async function CharterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.view");
  const { id } = await params;
  const data = await getRegulationDTO("charter", id);
  if (!data) notFound();
  return (
    <>
      <Link href="/structure?tab=charters" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Əsasnamələr reyestri
      </Link>
      <PageHeader title={`Əsasnamə · v${data.version}`} description={data.owner.label} />
      <RegulationView data={data} canEdit={can(user.role, "charter.edit")} canApprove={canApproveRegulations(user)} />
    </>
  );
}
