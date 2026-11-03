import { notFound } from "next/navigation";
import { PersonForm } from "@/components/employee/person-form";
import { PageHeader } from "@/components/layout/page-header";
import { salaryAccessFor } from "@/lib/auth/salary-access";
import { requireUser } from "@/lib/auth/session";
import { getPersonFormOptions, getPersonFormValues } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Redaktə" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.edit");
  const { id } = await params;
  const salary = await salaryAccessFor(user, id);
  const [initial, options] = await Promise.all([getPersonFormValues(id, { hidden: !salary.visible, locked: !salary.editable }), getPersonFormOptions()]);
  if (!initial) notFound();
  return (
    <>
      <PageHeader title={`${initial.lastName} ${initial.firstName} — redaktə`} description="Dəyişikliklər audit jurnalına sahə-sahə yazılır" />
      <PersonForm initial={initial} options={options} />
    </>
  );
}
