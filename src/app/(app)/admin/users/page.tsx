import { UsersAdmin } from "@/components/admin/users-admin";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPersonFormOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "İstifadəçilər" };

export default async function UsersPage() {
  const me = await requireUser("users.manage");
  const [users, { departments }] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { username: "asc" }],
      include: { department: { select: { name: true } }, createdBy: { select: { username: true } } },
    }),
    getPersonFormOptions(),
  ]);
  return (
    <>
      <PageHeader title="İstifadəçilər" description="Hesablar, rollar və şöbə rəhbərlərinin bölmələri · bütün dəyişikliklər audit jurnalına yazılır" />
      <UsersAdmin
        meId={me.id}
        departments={departments}
        users={users.map((u) => ({
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          departmentId: u.departmentId,
          departmentName: u.department?.name ?? null,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          createdBy: u.createdBy?.username ?? null,
        }))}
      />
    </>
  );
}
