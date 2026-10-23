import type { ImportBatchStatus } from "@prisma/client";
import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const MAP: Record<ImportBatchStatus, { label: string; variant: "default" | "success" | "warning" | "danger" | "outline"; icon: typeof LoaderIcon; spin?: boolean }> = {
  UPLOADED: { label: "Yükləndi", variant: "outline", icon: CircleDashedIcon },
  VALIDATING: { label: "Yoxlanılır", variant: "default", icon: LoaderIcon, spin: true },
  READY: { label: "Hazırdır", variant: "success", icon: CheckCircle2Icon },
  NEEDS_REVIEW: { label: "Düzəliş tələb olunur", variant: "warning", icon: AlertTriangleIcon },
  COMMITTING: { label: "Yazılır", variant: "default", icon: LoaderIcon, spin: true },
  COMPLETED: { label: "Tamamlandı", variant: "success", icon: CheckCircle2Icon },
  FAILED: { label: "Uğursuz", variant: "danger", icon: XCircleIcon },
};

export function ImportStatusBadge({ status }: { status: ImportBatchStatus }) {
  const m = MAP[status];
  return (
    <Badge variant={m.variant}>
      <m.icon className={m.spin ? "animate-spin" : undefined} />
      {m.label}
    </Badge>
  );
}
