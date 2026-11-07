import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { hiddenSalaryPersonIds } from "@/lib/auth/salary-access";
import { departmentScope } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { countByField, getCompletenessRows } from "@/lib/data-completeness";
import { COMPLETENESS_FIELDS, COMPLETENESS_KEYS, type CompletenessField } from "@/lib/unknown-values";
import { cn, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Məlumat tamlığı" };

const isField = (v: string | undefined): v is CompletenessField => !!v && (COMPLETENESS_KEYS as string[]).includes(v);

export default async function DataQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("employees.view");
  const sp = await searchParams;
  const field = isField(sp.field) ? sp.field : null;
  const q = (sp.q ?? "").trim().toLocaleLowerCase("az");
  const all = await getCompletenessRows(await departmentScope(user), await hiddenSalaryPersonIds(user));
  const counts = countByField(all);
  const rows = all.filter((r) => (!field || r.missing.includes(field)) && (!q || `${r.fullName} ${r.code} ${r.department ?? ""}`.toLocaleLowerCase("az").includes(q)));
  const exportHref = `/api/export/data-quality${field ? `?field=${field}` : ""}`;
  return (
    <>
      <PageHeader
        title="Məlumat tamlığı"
        description="Miqrasiyada mənbədə olmayan məcburi sahələr uydurulmur — «məlum deyil» kimi saxlanılır. Bu siyahı HR-ın doldurması üçündür (dosyedə «Redaktə»)."
        actions={
          <a href={exportHref} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-muted" data-export-quality>
            <DownloadIcon className="size-4" /> Excel
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" data-quality-filters>
        <FilterChip href={`/data-quality${q ? `?q=${encodeURIComponent(q)}` : ""}`} active={!field} label="Hamısı" count={all.length} />
        {COMPLETENESS_KEYS.map((k) => (
          <FilterChip key={k} href={`/data-quality?field=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} active={field === k} label={COMPLETENESS_FIELDS[k]} count={counts[k]} />
        ))}
      </div>
      <Card className="overflow-hidden">
        <form method="get" className="flex flex-wrap items-center gap-2 border-b p-3">
          {field && <input type="hidden" name="field" value={field} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Ad, kod və ya bölmə" className="h-9 w-full max-w-xs rounded-lg border bg-background px-3 text-sm" aria-label="Axtarış" />
          <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">Axtar</button>
          <span className="ml-auto text-xs text-muted-foreground" data-quality-count>
            {formatNumber(rows.length)} əməkdaş
          </span>
        </form>
        <DataTable
          rows={rows}
          rowKey={(r) => r.personId}
          empty={all.length === 0 ? "Bütün aktiv əməkdaşların məcburi sahələri doldurulub" : "Filtrə uyğun əməkdaş yoxdur"}
          columns={[
            { header: "Kod", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, className: "whitespace-nowrap" },
            {
              header: "Əməkdaş",
              minWidth: 200,
              cell: (r) => (
                <Link href={`/employees/${r.personId}`} className="font-medium hover:underline">
                  {r.fullName}
                </Link>
              ),
            },
            { header: "Bölmə / vəzifə", minWidth: 220, cell: (r) => <span className="text-muted-foreground">{[r.department, r.position].filter(Boolean).join(" · ")}</span> },
            {
              header: "Çatışmayan sahələr",
              minWidth: 260,
              cell: (r) => (
                <div className="flex flex-wrap gap-1" data-missing={r.missing.join(",")}>
                  {r.missing.map((f) => (
                    <Badge key={f} variant={f === "openingUnverified" ? "outline" : "warning"}>
                      {COMPLETENESS_FIELDS[f]}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              header: "Açılış stajı",
              cell: (r) => (r.openingSeniorityYears === null ? "—" : `${formatNumber(r.openingSeniorityYears, 2)} il`),
              className: "whitespace-nowrap tabular-nums",
            },
            {
              header: " ",
              cell: (r) => (
                <Link href={`/employees/${r.personId}/edit`} className="text-xs text-primary hover:underline">
                  Doldur
                </Link>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", active ? "border-primary/50 bg-accent font-medium text-primary" : "bg-card hover:bg-muted")}
      data-active={active || undefined}
    >
      {label}
      <span className="rounded-full bg-muted px-1.5 tabular-nums">{formatNumber(count)}</span>
    </Link>
  );
}
