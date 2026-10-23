"use client";

import { ShieldCheckIcon } from "lucide-react";
import { startTransition, useActionState } from "react";
import { setupRootAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupRootAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">İlkin quraşdırma</CardTitle>
        <CardDescription>Sistemdə hələ istifadəçi yoxdur. Root (administrator) hesabını yaradın — sonra digər istifadəçiləri o əlavə edəcək.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          // Xəta olduqda daxil edilənlər itməsin (React 19 action-dan sonra formanı sıfırlayır)
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => action(data));
          }}
          className="flex flex-col gap-4"
        >
          <FormField label="İstifadəçi adı" htmlFor="username" error={fe.username} required>
            <Input id="username" name="username" defaultValue="root" autoCapitalize="none" required />
          </FormField>
          <FormField label="Ad, soyad" htmlFor="fullName" error={fe.fullName} required>
            <Input id="fullName" name="fullName" required />
          </FormField>
          <FormField label="Şifrə" htmlFor="password" error={fe.password} hint="Ən azı 8 simvol, hərf və rəqəm" required>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </FormField>
          <FormField label="Şifrəni təkrarlayın" htmlFor="confirm" error={fe.confirm} required>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </FormField>
          {state.error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <Button type="submit" disabled={pending}>
            <ShieldCheckIcon /> Root hesabını yarat
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
