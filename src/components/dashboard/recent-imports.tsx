import { ArrowRightIcon, FileSpreadsheetIcon } from "lucide-react";
import Link from "next/link";
import { ImportStatusBadge } from "@/components/import/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentImport } from "@/lib/queries";
import { formatIsoDate } from "@/lib/utils";

export function RecentImports({ batches }: { batches: RecentImport[] }) {
  if (batches.length === 0) return null;
  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle>Son idxallar</CardTitle>
          <CardDescription className="mt-0.5">Excel şablonlarının yüklənməsi və yoxlanılması</CardDescription>
        </div>
        <Link href="/import" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
          İdxal mərkəzi <ArrowRightIcon className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="divide-y">
        {batches.map((b) => (
          <Link key={b.id} href={`/import?batch=${b.id}`} className="group flex items-center gap-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
              <FileSpreadsheetIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold transition-colors group-hover:text-primary">{b.files.join(", ")}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {formatIsoDate(b.createdAt)} {b.createdAt.slice(11, 16)}
              </div>
            </div>
            <ImportStatusBadge status={b.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
