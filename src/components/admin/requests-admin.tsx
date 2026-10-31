"use client";

import type { DeletionRequestStatus, DocumentKind } from "@prisma/client";
import { CheckIcon, ExternalLinkIcon, FileTextIcon, InboxIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { approveDeletionRequestAction, rejectDeletionRequestAction } from "@/actions/documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DOCUMENT_KINDS } from "@/lib/document-types";
import { formatDateTime } from "@/lib/utils";

export interface RequestRow {
  id: string;
  status: DeletionRequestStatus;
  personId: string;
  personName: string;
  documentId: string | null;
  documentTitle: string;
  fileName: string;
  kind: DocumentKind | null;
  number: string | null;
  reason: string;
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const STATUS: Record<DeletionRequestStatus, { label: string; variant: "warning" | "danger" | "success" }> = {
  PENDING: { label: "Gözləyir", variant: "warning" },
  APPROVED: { label: "Təsdiq edildi — silindi", variant: "danger" },
  REJECTED: { label: "İmtina edildi", variant: "success" },
};

type Decision = { row: RequestRow; approve: boolean } | null;

export function RequestsAdmin({ rows, history }: { rows: RequestRow[]; history: boolean }) {
  const [decision, setDecision] = useState<Decision>(null);

  if (rows.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
        <InboxIcon className="size-8 text-primary/60" />
        <span className="font-medium text-foreground">{history ? "Hələ baxılmış sorğu yoxdur" : "Gözləyən sorğu yoxdur"}</span>
        {!history && <span>İstifadəçilər sənəd silmək istədikdə sorğu burada görünəcək</span>}
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
              <FileTextIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.documentTitle}</span>
                {r.kind && <Badge variant="outline">{DOCUMENT_KINDS[r.kind]}</Badge>}
                {r.number && <span className="text-xs text-muted-foreground">№ {r.number}</span>}
                {history && <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <Link href={`/employees/${r.personId}?tab=documents`} className="font-medium text-foreground hover:text-primary hover:underline">
                  {r.personName}
                </Link>
                <span>{r.fileName}</span>
                {r.documentId && (
                  <a href={`/api/documents/${r.documentId}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <ExternalLinkIcon className="size-3.5" /> Sənədə bax
                  </a>
                )}
              </div>
              <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Səbəb: </span>
                {r.reason}
              </div>
              <div className="text-xs text-muted-foreground">
                Sorğu: {r.requestedBy} · {formatDateTime(r.createdAt)}
                {r.decidedAt && (
                  <>
                    {" "}
                    — qərar: {r.decidedBy ?? "—"} · {formatDateTime(r.decidedAt)}
                    {r.decisionNote && ` · qeyd: ${r.decisionNote}`}
                  </>
                )}
              </div>
            </div>
            {!history && (
              <div className="flex shrink-0 gap-2 sm:flex-col">
                <Button variant="destructive" size="sm" onClick={() => setDecision({ row: r, approve: true })}>
                  <Trash2Icon /> Təsdiq et və sil
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDecision({ row: r, approve: false })}>
                  <XIcon /> İmtina et
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {decision && <DecisionDialog decision={decision} onClose={() => setDecision(null)} />}
    </>
  );
}

function DecisionDialog({ decision, onClose }: { decision: NonNullable<Decision>; onClose: () => void }) {
  const router = useRouter();
  const { row, approve } = decision;
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = approve ? await approveDeletionRequestAction(row.id) : await rejectDeletionRequestAction(row.id, note);
      if (res.error) return setError(res.error);
      toast.success(approve ? "Sorğu təsdiq edildi, sənəd silindi" : "Sorğudan imtina edildi, sənəd qalır");
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{approve ? "Sorğunu təsdiq etmək" : "Sorğudan imtina etmək"}</DialogTitle>
            <DialogDescription>
              <b className="text-foreground">{row.documentTitle}</b> ({row.personName}) —{" "}
              {approve ? "sənəd şəxsi işdən və diskdən silinəcək (backup-larda qalır)." : "sənəd şəxsi işdə qalacaq."} Qərar audit jurnalına yazılır.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Səbəb ({row.requestedBy}): </span>
            {row.reason}
          </div>
          {!approve && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Qeyd (istəyə görə)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
                rows={2}
                maxLength={300}
                placeholder="məs. əmr arxivdə saxlanılmalıdır"
                className="min-h-16 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
            </label>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Ləğv et
            </Button>
            <Button type="submit" variant={approve ? "destructive" : "default"} disabled={pending}>
              {approve ? <Trash2Icon /> : <CheckIcon />} {pending ? "Gözləyin…" : approve ? "Təsdiq et və sil" : "İmtina et"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
