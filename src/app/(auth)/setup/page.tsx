import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth/setup-form";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "İlkin quraşdırma" };

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return <SetupForm />;
}
