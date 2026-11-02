"use client";

import { KeyRoundIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { toast } from "sonner";
import { changePasswordAction, logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";

export function ChangePasswordForm({ forced, username, fullName }: { forced: boolean; username: string; fullName: string }) {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;
    toast.success("Şifrə dəyişdirildi", { description: state.closedSessions ? `Digər ${state.closedSessions} sessiya bağlandı` : undefined });
    router.replace("/dashboard");
    router.refresh();
  }, [state, router]);

  const fe = state.fieldErrors ?? {};
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{forced ? "Yeni şifrə təyin edin" : "Şifrəni dəyiş"}</CardTitle>
        <CardDescription>
          {forced ? (
            <>
              <b className="text-foreground">{fullName}</b> (@{username}), hesabınız administrator tərəfindən verilmiş şifrə ilə açılıb. Davam etmək üçün özünüzə məxsus yeni şifrə təyin edin.
            </>
          ) : (
            <>
              @{username} · dəyişiklikdən sonra digər brauzer və kompüterlərdəki sessiyalar bağlanacaq
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => action(data));
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          {/* Parol menecerləri üçün */}
          <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
          <FormField label={forced ? "Verilmiş (cari) şifrə" : "Cari şifrə"} htmlFor="current" error={fe.current} required>
            <Input id="current" name="current" type="password" autoComplete="current-password" autoFocus aria-invalid={!!fe.current} />
          </FormField>
          <FormField label="Yeni şifrə" htmlFor="password" error={fe.password} hint="Ən azı 8 simvol, hərf və rəqəm" required>
            <Input id="password" name="password" type="password" autoComplete="new-password" aria-invalid={!!fe.password} />
          </FormField>
          <FormField label="Yeni şifrə (təkrar)" htmlFor="confirm" error={fe.confirm} required>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" aria-invalid={!!fe.confirm} />
          </FormField>
          {state.error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <Button type="submit" disabled={pending || state.ok}>
            <KeyRoundIcon /> {pending ? "Yoxlanılır…" : "Şifrəni dəyiş"}
          </Button>
          {forced ? (
            <Button type="button" variant="ghost" onClick={() => startTransition(() => logoutAction())}>
              <LogOutIcon /> Çıxış
            </Button>
          ) : (
            <Button type="button" variant="ghost" asChild>
              <Link href="/dashboard">Ləğv et</Link>
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
