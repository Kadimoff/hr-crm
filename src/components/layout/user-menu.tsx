"use client";

import { LogOutIcon } from "lucide-react";
import { startTransition } from "react";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import { initials } from "@/lib/utils";

export function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2" aria-label="İstifadəçi menyusu">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(user.fullName)}</span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-sm font-medium">{user.fullName}</span>
            <span className="block text-[11px] font-normal text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{user.fullName}</span>
          <span className="font-mono font-normal">@{user.username}</span>
          <span className="font-normal">
            {ROLE_LABELS[user.role]}
            {user.departmentName && ` · ${user.departmentName}`}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Menyu seçimdən sonra dərhal bağlandığı üçün <form> yox, birbaşa action çağırışı */}
        <DropdownMenuItem className="text-danger data-[highlighted]:text-danger" onSelect={() => startTransition(() => logoutAction())}>
          <LogOutIcon /> Çıxış
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
