"use client";

import { LogInIcon } from "lucide-react";
import { startTransition, useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sistemə giriş</CardTitle>
        <CardDescription>İstifadəçi adınızı və şifrənizi daxil edin</CardDescription>
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
          <input type="hidden" name="next" value={next} />
          <FormField label="İstifadəçi adı" htmlFor="username">
            <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoFocus required />
          </FormField>
          <FormField label="Şifrə" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </FormField>
          {state.error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
          <Button type="submit" disabled={pending}>
            <LogInIcon /> {pending ? "Yoxlanılır…" : "Daxil ol"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
