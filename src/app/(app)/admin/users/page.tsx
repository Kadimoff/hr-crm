import { UsersAdmin } from "@/components/admin/users-admin";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPersonFormOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "İstifadəçilər" };

export default async function UsersPage() {
  const me = await requireUser("users.manage");
  const [users, { departments }, persons] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { username: "asc" }],
      include: { department: { select: { name: true } }, createdBy: { select: { username: true } }, person: { select: { code: true, fullName: true } } },
    }),
    getPersonFormOptions(),
    // Hesabı əməkdaşa bağlamaq üçün axtarış siyahısı (yalnız root görür)
    prisma.person.findMany({ where: { deletedAt: null }, orderBy: { fullName: "asc" }, select: { code: true, fullName: true } }),
  ]);
  return (
    <>
      <PageHeader title="İstifadəçilər" description="Hesablar, rollar və şöbə rəhbərlərinin bölmələri · bütün dəyişikliklər audit jurnalına yazılır" />
      <UsersAdmin
        meId={me.id}
        departments={departments}
        persons={persons.map((p) => `${p.code} — ${p.fullName}`)}
        users={users.map((u) => ({
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          departmentId: u.departmentId,
          departmentName: u.department?.name ?? null,
          isActive: u.isActive,
          canDeleteDocuments: u.canDeleteDocuments,
          person: u.person ? `${u.person.code} — ${u.person.fullName}` : null,
          canViewRestrictedSalaries: u.canViewRestrictedSalaries,
          mustChangePassword: u.mustChangePassword,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          createdBy: u.createdBy?.username ?? null,
        }))}
      />
    </>
  );
}
