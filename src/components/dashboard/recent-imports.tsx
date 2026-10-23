import Link from "next/link";
import { ImportStatusBadge } from "@/components/import/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentImport } from "@/lib/queries";
import { formatIsoDate } from "@/lib/utils";

export function RecentImports({ batches }: { batches: RecentImport[] }) {
  if (batches.length === 0) return null;
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Son idxallar</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {batches.map((b) => (
          <Link key={b.id} href={`/import?batch=${b.id}`} className="flex items-center gap-3 py-2.5 text-sm transition-colors hover:text-primary">
            <ImportStatusBadge status={b.status} />
            <span className="truncate">{b.files.join(", ")}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatIsoDate(b.createdAt)} {b.createdAt.slice(11, 16)}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
