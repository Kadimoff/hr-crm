"use client";

import { LoaderIcon, PencilIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveContractEndAction } from "@/actions/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ContractEndEditor({ employmentId, owner, decision, canEdit }: { employmentId: string; owner: string | null; decision: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [o, setO] = useState(owner ?? "");
  const [dc, setDc] = useState(decision ?? "");
  const [pending, start] = useTransition();
  if (!open)
    return (
      <div className="flex items-start gap-1.5 text-sm" data-contract-decision>
        <div className="min-w-0">
          <div>{owner ?? <span className="text-muted-foreground">məsul təyin edilməyib</span>}</div>
          <div className="text-xs text-muted-foreground">{decision ?? "qərar yoxdur"}</div>
        </div>
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-7" onClick={() => setOpen(true)} aria-label="Məsul və qərar">
            <PencilIcon className="size-3.5" />
          </Button>
        )}
      </div>
    );
  return (
    <div className="flex min-w-56 flex-col gap-1.5" data-contract-decision-form>
      <Input value={o} onChange={(e) => setO(e.currentTarget.value)} placeholder="Məsul (ad, vəzifə)" aria-label="Məsul" />
      <Input value={dc} onChange={(e) => setDc(e.currentTarget.value)} placeholder="Qərar: uzadılır / xitam / yeni müqavilə" aria-label="Qərar" />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveContractEndAction(employmentId, o, dc);
              if (r.error) toast.error(r.error);
              else {
                toast.success("Saxlanıldı");
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending && <LoaderIcon className="animate-spin" />} Saxla
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Ləğv
        </Button>
      </div>
    </div>
  );
}
