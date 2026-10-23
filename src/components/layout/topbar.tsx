import { ThemeToggle } from "@/components/theme-toggle";
import type { CurrentUser } from "@/lib/auth/session";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./sidebar";
import { UserMenu } from "./user-menu";

export function Topbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md md:px-6">
      <MobileNav role={user.role} />
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
