"use client";

import { ArchiveRestoreIcon, PencilIcon, PrinterIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { archivePersonAction, restorePersonAction } from "@/actions/persons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DELETE_CONFIRM_WORD, matchesConfirmWord } from "@/lib/confirm";

const FLASH: Record<string, string> = { created: "Əməkdaş əlavə edildi", updated: "Dəyişikliklər saxlanıldı" };

/** ?saved=... parametri ilə gələn bildiriş — göstərilir və URL-dən silinir */
export function SavedToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const saved = params.get("saved");
  useEffect(() => {
    if (saved && FLASH[saved]) {
      toast.success(FLASH[saved]);
      router.replace(pathname, { scroll: false });
    }
  }, [saved, pathname, router]);
  return null;
}

export function DeletePersonDialog({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ok = matchesConfirmWord(text);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    start(async () => {
      const res = await archivePersonAction(id, text);
      if (res.error) return setError(res.error);
      toast.success(`${name} silindi (arxivə köçürüldü)`);
      setOpen(false);
      router.push("/employees");
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setText("");
        setError(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger">
          <Trash2Icon /> Sil
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Əməkdaşı silmək</DialogTitle>
            <DialogDescription>
              <b className="text-foreground">{name}</b> siyahılardan, hesabatlardan və idarə panelindən çıxarılacaq. Qeyd arxivdə saxlanılır və administrator tərəfindən bərpa oluna bilər. Əməliyyat audit jurnalına yazılır.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span>
              Təsdiq üçün <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-danger">{DELETE_CONFIRM_WORD}</code> yazın
            </span>
            <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus autoComplete="off" spellCheck={false} aria-label="Təsdiq sözü" />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Ləğv et
            </Button>
            <Button type="submit" variant="destructive" disabled={!ok || pending}>
              <Trash2Icon /> {pending ? "Silinir…" : "Sil"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RestorePersonButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await restorePersonAction(id);
          if (res.error) toast.error(res.error);
          else {
            toast.success("Əməkdaş bərpa edildi");
            router.refresh();
          }
        })
      }
    >
      <ArchiveRestoreIcon /> Bərpa et
    </Button>
  );
}

export function PersonToolbar({ id, name, canEdit, archived }: { id: string; name: string; canEdit: boolean; archived: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/employees/${id}/print`} target="_blank">
          <PrinterIcon /> Çap
        </Link>
      </Button>
      {canEdit && !archived && (
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/employees/${id}/edit`}>
              <PencilIcon /> Redaktə et
            </Link>
          </Button>
          <DeletePersonDialog id={id} name={name} />
        </>
      )}
      {canEdit && archived && <RestorePersonButton id={id} />}
    </div>
  );
}
