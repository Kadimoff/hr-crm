import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { can } from "@/lib/auth/roles";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { getSidebarSummary } from "@/lib/queries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const summary = await getSidebarSummary(await departmentScope(user), can(user.role, "requests.manage"));
  return (
    <div className="flex min-h-dvh">
      <Sidebar role={user.role} summary={summary} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} summary={summary} />
        <main className="w-full flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
