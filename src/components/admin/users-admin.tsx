"use client";

import type { UserRole } from "@prisma/client";
import { KeyRoundIcon, PencilIcon, UserPlusIcon } from "lucide-react";
import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { createUserAction, resetPasswordAction, updateUserAction, type UserFormState } from "@/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { cn, formatDateTime, initials } from "@/lib/utils";

export interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

type Dept = { value: string; label: string; hint?: string };

const ROLE_VARIANT: Record<UserRole, "default" | "outline" | "warning"> = { ROOT: "warning", HR: "default", DEPT_HEAD: "outline" };
const ROLE_HINT: Record<UserRole, string> = {
  ROOT: "Hər şey + istifadəçilər və audit jurnalı",
  HR: "Əməkdaşların əlavəsi, redaktəsi, silinməsi, idxal, hesabatlar",
  DEPT_HEAD: "Yalnız öz bölməsinin əməkdaşlarına baxış, çap, hesabatlar",
};

/** Dialoq formu: uğurda bağlanır və bildiriş göstərir; xətada daxil edilənlər qorunur */
function useDialogForm(action: (s: UserFormState, f: FormData) => Promise<UserFormState>, successMessage: string) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.ok) {
      toast.success(successMessage);
      setOpen(false);
    }
  }, [state, successMessage]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return { open, setOpen, state, pending, onSubmit, fe: state.ok ? {} : (state.fieldErrors ?? {}) };
}

function RoleFields({ departments, defaultRole, defaultDepartment, fe, lockRole }: { departments: Dept[]; defaultRole?: UserRole; defaultDepartment?: string | null; fe: Record<string, string>; lockRole?: boolean }) {
  const [role, setRole] = useState<string>(defaultRole ?? "");
  const [dept, setDept] = useState<string>(defaultDepartment ?? "");
  return (
    <>
      <FormField label="Rol" htmlFor="role" error={fe.role} hint={role ? ROLE_HINT[role as UserRole] : undefined} required>
        <input type="hidden" name="role" value={role} />
        <Select value={role} onValueChange={setRole} disabled={lockRole}>
          <SelectTrigger id="role" className="w-full">
            <SelectValue placeholder="Seçin" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {role === "DEPT_HEAD" && (
        <FormField label="Struktur bölmə" htmlFor="departmentId" error={fe.departmentId} hint="Alt bölmələr avtomatik daxildir" required>
          <input type="hidden" name="departmentId" value={dept} />
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger id="departmentId" className="w-full">
              <SelectValue placeholder="Seçin" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
    </>
  );
}

function FormError({ message }: { message?: string }) {
  return message ? <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p> : null;
}

function CreateUserDialog({ departments }: { departments: Dept[] }) {
  const f = useDialogForm(createUserAction, "İstifadəçi yaradıldı");
  return (
    <Dialog open={f.open} onOpenChange={f.setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon /> Yeni istifadəçi
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* key: dialoq hər açılanda forma təmiz başlayır */}
        <form key={String(f.open)} onSubmit={f.onSubmit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Yeni istifadəçi</DialogTitle>
            <DialogDescription>İstifadəçi adı ilə sistemə daxil olacaq. Şifrəni ona təhlükəsiz yolla çatdırın.</DialogDescription>
          </DialogHeader>
          <FormField label="İstifadəçi adı" htmlFor="username" error={f.fe.username} hint="Latın hərfləri, rəqəm, . _ - (məs. a.memmedov)" required>
            <Input id="username" name="username" autoCapitalize="none" autoComplete="off" />
          </FormField>
          <FormField label="Ad, soyad" htmlFor="fullName" error={f.fe.fullName} required>
            <Input id="fullName" name="fullName" />
          </FormField>
          <RoleFields departments={departments} fe={f.fe} />
          <FormField label="Şifrə" htmlFor="password" error={f.fe.password} hint="Ən azı 8 simvol, hərf və rəqəm" required>
            <Input id="password" name="password" type="password" autoComplete="new-password" />
          </FormField>
          <FormError message={f.state.error} />
          <DialogFooter>
            <Button type="submit" disabled={f.pending}>
              <UserPlusIcon /> Yarat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, departments, isMe }: { user: UserRow; departments: Dept[]; isMe: boolean }) {
  const f = useDialogForm(updateUserAction, "Dəyişikliklər saxlanıldı");
  return (
    <Dialog open={f.open} onOpenChange={f.setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`@${user.username} — redaktə`} title="Redaktə">
          <PencilIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form key={String(f.open)} onSubmit={f.onSubmit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="id" value={user.id} />
          <DialogHeader>
            <DialogTitle>@{user.username}</DialogTitle>
            <DialogDescription>Rol dəyişəndə və ya hesab deaktiv ediləndə istifadəçinin açıq sessiyaları bağlanır.</DialogDescription>
          </DialogHeader>
          <FormField label="Ad, soyad" htmlFor="fullName" error={f.fe.fullName} required>
            <Input id="fullName" name="fullName" defaultValue={user.fullName} />
          </FormField>
          <RoleFields departments={departments} defaultRole={user.role} defaultDepartment={user.departmentId} fe={f.fe} lockRole={isMe} />
          <label className={cn("flex items-center gap-2 text-sm", isMe && "opacity-50")}>
            <input type="checkbox" name="isActive" defaultChecked={user.isActive} disabled={isMe} className="size-4 accent-[var(--primary)]" />
            Hesab aktivdir
            {isMe && <input type="hidden" name="isActive" value="on" />}
          </label>
          <FormError message={f.state.error} />
          <DialogFooter>
            <Button type="submit" disabled={f.pending}>
              Saxla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user }: { user: UserRow }) {
  const f = useDialogForm(resetPasswordAction, `@${user.username} üçün şifrə yeniləndi`);
  return (
    <Dialog open={f.open} onOpenChange={f.setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`@${user.username} — şifrəni sıfırla`} title="Şifrəni sıfırla">
          <KeyRoundIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form key={String(f.open)} onSubmit={f.onSubmit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="id" value={user.id} />
          <DialogHeader>
            <DialogTitle>Şifrəni sıfırla — @{user.username}</DialogTitle>
            <DialogDescription>İstifadəçinin bütün açıq sessiyaları bağlanacaq.</DialogDescription>
          </DialogHeader>
          <FormField label="Yeni şifrə" htmlFor="password" error={f.fe.password} hint="Ən azı 8 simvol, hərf və rəqəm" required>
            <Input id="password" name="password" type="password" autoComplete="new-password" autoFocus />
          </FormField>
          <FormError message={f.state.error} />
          <DialogFooter>
            <Button type="submit" disabled={f.pending}>
              <KeyRoundIcon /> Yenilə
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersAdmin({ users, departments, meId }: { users: UserRow[]; departments: Dept[]; meId: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <span className="px-1 text-sm text-muted-foreground tabular-nums">
          {users.filter((u) => u.isActive).length} aktiv · {users.length} cəmi
        </span>
        <CreateUserDialog departments={departments} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">İstifadəçi</th>
              <th className="px-3 py-2.5 font-medium">Rol</th>
              <th className="px-3 py-2.5 font-medium">Bölmə</th>
              <th className="px-3 py-2.5 font-medium">Son giriş</th>
              <th className="px-3 py-2.5 font-medium">Yaradıb</th>
              <th className="w-24 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={cn("border-b last:border-0", !u.isActive && "opacity-55")}>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(u.fullName)}</span>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {u.fullName}
                        {u.id === meId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(siz)</span>}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={ROLE_VARIANT[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    {!u.isActive && <Badge variant="danger">Deaktiv</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2.5">{u.departmentName ?? <span className="text-muted-foreground/70">—</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-muted-foreground/70">—</span>}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {u.createdBy ? <span className="font-mono">@{u.createdBy}</span> : "ilkin quraşdırma"}
                  <div className="tabular-nums">{formatDateTime(u.createdAt)}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <ResetPasswordDialog user={u} />
                    <EditUserDialog user={u} departments={departments} isMe={u.id === meId} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
