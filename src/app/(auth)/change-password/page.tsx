import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Şifrəni dəyiş" };

/** Həm istifadəçi menyusundan, həm də məcburi dəyişmə (ilk giriş / root sıfırlaması) üçün — tətbiq qabığından kənarda */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/change-password");
  return <ChangePasswordForm forced={user.mustChangePassword} username={user.username} fullName={user.fullName} />;
}
