import { PersonForm } from "@/components/employee/person-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { getPersonFormOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Yeni əməkdaş" };

export default async function NewEmployeePage() {
  await requireUser("employees.edit");
  const options = await getPersonFormOptions();
  return (
    <>
      <PageHeader title="Yeni əməkdaş" description="Şəxsi məlumatlar, sənəd və əsas iş yeri — qeydiyyat sizin adınızla jurnala yazılır" />
      <PersonForm options={options} />
    </>
  );
}
