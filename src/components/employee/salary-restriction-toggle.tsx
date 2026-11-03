"use client";

import { LockIcon, LockOpenIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { setPersonSalaryRestrictedAction } from "@/actions/salary-privacy";
import { Button } from "@/components/ui/button";

/** Dosyedə (root / səlahiyyətli hesab): şəxs səviyyəsində «maaş məxfidir» işarəsi */
export function SalaryRestrictionToggle({ personId, restricted }: { personId: string; restricted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      data-salary-toggle={restricted ? "on" : "off"}
      title="Bölmə və hesab bağlantısından asılı olmayaraq bu şəxsin maaşını məxfi edir"
      onClick={() =>
        start(async () => {
          const res = await setPersonSalaryRestrictedAction(personId, !restricted);
          if (res.error) toast.error(res.error);
          else {
            toast.success(restricted ? "Şəxs üzrə məxfilik götürüldü" : "Maaş məxfi edildi");
            router.refresh();
          }
        })
      }
    >
      {restricted ? <LockOpenIcon /> : <LockIcon />} {restricted ? "Şəxs üzrə məxfiliyi götür" : "Maaşı məxfi et"}
    </Button>
  );
}
