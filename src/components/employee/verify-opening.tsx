"use client";

import { LoaderIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { verifyOpeningSeniorityAction } from "@/actions/documents";
import { Button } from "@/components/ui/button";

/** Açılış stajı (miqrasiya) sənədlə tutuşdurulub — «yoxlanılıb» */
export function VerifyOpeningButton({ personId }: { personId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        confirm("Açılış stajı əmək kitabçası / sənədlərlə tutuşdurulub?") &&
        start(async () => {
          const r = await verifyOpeningSeniorityAction(personId);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Açılış stajı yoxlanılıb kimi qeyd edildi");
            router.refresh();
          }
        })
      }
      data-verify-opening
    >
      {pending ? <LoaderIcon className="animate-spin" /> : <ShieldCheckIcon />} Sənədlə yoxlanıldı
    </Button>
  );
}
