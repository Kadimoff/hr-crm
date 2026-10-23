import { DatabaseAdmin } from "@/components/admin/database-admin";
import { PageHeader } from "@/components/layout/page-header";
import { listBackups, tableCounts } from "@/lib/admin/database";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verilənlər bazası" };

export default async function DatabasePage() {
  await requireUser("database.manage");
  const [counts, backups] = await Promise.all([tableCounts(), listBackups()]);
  return (
    <>
      <PageHeader title="Verilənlər bazası" description="Backup, bərpa və bütün məlumatların silinməsi · yalnız administrator · bütün əməliyyatlar audit jurnalına yazılır" />
      <DatabaseAdmin counts={counts} backups={backups} />
    </>
  );
}
