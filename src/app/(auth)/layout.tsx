import { BuildingIcon } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BuildingIcon className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold">ASOİU HR CRM</div>
            <div className="text-xs text-muted-foreground">Kadr və əməkhaqqı</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
