import { PageHeader } from "@/components/layout/page-header";
import { OrgChart } from "@/components/org/org-chart";
import { getOrgTree } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Struktur" };

export default async function OrgChartPage() {
  const tree = await getOrgTree();
  return (
    <>
      <PageHeader title="Təşkilati struktur" description="4 səviyyəli iyerarxiya · fakültələr, kafedralar, ştat vahidləri və vakansiyalar" />
      <OrgChart tree={tree} />
    </>
  );
}
