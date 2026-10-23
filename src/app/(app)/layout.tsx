import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
