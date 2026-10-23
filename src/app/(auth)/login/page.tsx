import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if ((await prisma.user.count()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return <LoginForm next={next ?? ""} />;
}
