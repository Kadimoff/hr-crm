import { CalendarIcon, CalendarSearchIcon, HistoryIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { FINANCE_FIELD_LABELS, FINANCE_SOURCE_LABELS, formatFinanceValue } from "@/lib/finance-history";
import type { FinanceHistory, FinanceTimelineRow } from "@/lib/queries";
import { cn, formatAzn, formatDateTime } from "@/lib/utils";
import { formatAzDate } from "@/lib/validation/primitives";

const d = (v: Date | null | undefined) => (v ? formatAzDate(v) : "—");

function fieldLabel(r: FinanceTimelineRow) {
  if (r.field === "HIRE") return "İşə qəbul";
  if (r.field === "TERMINATION") return "Azad olunma";
  return FINANCE_FIELD_LABELS[r.field];
}

function change(r: FinanceTimelineRow) {
  if (r.field === "HIRE" || r.field === "TERMINATION") return <span className="whitespace-normal">{r.newText ?? "—"}</span>;
  return (
    <span className="whitespace-normal">
      <span className="text-muted-foreground">{formatFinanceValue(r.field, r.oldValue, r.oldLabel)}</span>
      <span className="mx-1.5 text-muted-foreground">→</span>
      <span className="font-medium">{formatFinanceValue(r.field, r.newValue, r.newLabel)}</span>
    </span>
  );
}

function basis(r: FinanceTimelineRow) {
  if (r.source === "HIRE") return "Əmək müqaviləsi";
  if (r.source === "TERMINATION") return "Xitam";
  const src = FINANCE_SOURCE_LABELS[r.source];
  return (
    <div className="flex flex-col gap-0.5">
      {r.orderNumber ? (
        <span className="whitespace-nowrap">
          Əmr № {r.orderNumber} · {d(r.orderDate)}
        </span>
      ) : (
        <span>{r.source === "EDIT" ? "Redaktə" : src}</span>
      )}
      {r.orderNumber && <span className="text-[11px] text-muted-foreground">{src}</span>}
      {r.derived && <span className="text-[11px] text-muted-foreground">köhnə qeyddən bərpa</span>}
    </div>
  );
}

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
  <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn("text-right tabular-nums", strong && "font-semibold")}>{value}</span>
  </div>
);

/** Dosyedə «Maliyyə tarixçəsi»: tarixə görə baxış + zaman xətti + oklad dövrləri. Yalnız «finance.history» icazəsi ilə render olunur. */
export function FinanceHistoryTab({ data, asOf }: { data: FinanceHistory; asOf?: string }) {
  const snap = data.snapshot;
  return (
    <>
      <Card data-finance-asof>
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <CalendarSearchIcon className="size-4 text-muted-foreground" />
          <div>
            <CardTitle>Tarixə görə baxış</CardTitle>
            <CardDescription>Seçilmiş gündə qüvvədə olan vəzifə, bölmə, oklad, ştat payı və hesablanmış əməkhaqqı (oklad tarixçəsi və hərəkətlərdən)</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="finance" />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Tarix
              <DateInput name="asOf" defaultValue={asOf ?? ""} className="w-40" aria-label="Baxış tarixi" />
            </label>
            <Button type="submit" size="sm" variant="outline">
              <CalendarSearchIcon /> Göstər
            </Button>
          </form>
          {snap &&
            (snap.employments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d(snap.day)} tarixində qüvvədə olan əmək müqaviləsi yox idi.</p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {snap.employments.map((e) => (
                  <div key={e.id} className="rounded-lg border p-4" data-snapshot-employment>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.positionName}</span>
                      <Badge variant="outline">{e.isPrimary ? "Əsas iş yeri" : "Əvəzçilik"}</Badge>
                    </div>
                    <Row label="Tarix" value={d(snap.day)} />
                    <Row label="Struktur bölmə" value={e.departmentName} />
                    <Row label="Oklad" value={<span data-snapshot-salary>{formatAzn(e.baseSalary)}</span>} strong />
                    <Row label="Ştat payı" value={e.unitShare.toFixed(2)} />
                    <Row label="Ödəniş forması" value={e.paymentForm || "—"} />
                    <Row label="Zərərli şərait əlavəsi" value={e.hazardousPct ? `${e.hazardousPct}%` : "—"} />
                    <Row label="Vergi güzəşti" value={e.primaryForAllowances && snap.person.taxExemptionClause ? `VM ${snap.person.taxExemptionClause}` : "—"} />
                    <Row
                      label="Elmi dərəcə / ad"
                      value={e.primaryForAllowances ? [...snap.person.degrees.map((x) => x.name), ...snap.person.titles.map((x) => x.name)].join("; ") || "—" : "əvəzçilikdə tətbiq olunmur"}
                    />
                    <Row label="Brutto" value={<span data-snapshot-gross>{formatAzn(e.payroll.gross)}</span>} strong />
                    <Row label="Netto (təxmini)" value={<span data-snapshot-net>{formatAzn(e.payroll.net)}</span>} strong />
                  </div>
                ))}
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">
            Hesablama cari əməkhaqqı qaydaları ilə aparılır; elmi dərəcə / ad verilmə tarixinə görə, zərərli şərait faizi vəzifəyə görə götürülür.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" />
          <div>
            <CardTitle>Dəyişikliklərin zaman xətti</CardTitle>
            <CardDescription>Əməkhaqqına təsir edən hər dəyişiklik: köhnə → yeni dəyər, qüvvəyə minmə tarixi, əsas və kim dəyişib</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.timeline.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Dəyişiklik qeydə alınmayıb</p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm" data-finance-timeline>
                <thead>
                  <tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                    {["Qüvvəyə minir", "Sahə", "Köhnə → yeni", "Müqavilə", "Əsas", "Kim / nə vaxt"].map((h) => (
                      <th key={h} className="px-5 py-2 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.timeline.map((r) => (
                    <tr key={r.key} className="border-b last:border-0" data-finance-row={r.field} data-finance-source={r.source}>
                      <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">{d(r.date)}</td>
                      <td className="px-5 py-2.5">
                        <Badge variant={r.field === "HIRE" ? "success" : r.field === "TERMINATION" ? "danger" : "outline"}>{fieldLabel(r)}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{change(r)}</td>
                      <td className="px-5 py-2.5 text-xs text-muted-foreground">{r.employment ?? "şəxs üzrə"}</td>
                      <td className="px-5 py-2.5 text-xs">{basis(r)}</td>
                      <td className="px-5 py-2.5 text-xs text-muted-foreground">
                        {r.by ?? (r.source === "IMPORT" ? "idxal" : "—")}
                        {r.createdAt && <span className="block text-[11px]">{formatDateTime(r.createdAt)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.salaryHistory.map((h) => (
        <Card key={h.employment}>
          <CardHeader className="flex-row flex-wrap items-center gap-2">
            <CalendarIcon className="size-4 text-muted-foreground" />
            <div>
              <CardTitle>Oklad tarixçəsi</CardTitle>
              <CardDescription>{h.employment}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Dövr</th>
                    <th className="px-5 py-2 text-right font-medium">Oklad</th>
                  </tr>
                </thead>
                <tbody>
                  {h.records.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-5 py-2.5 tabular-nums">
                        {d(r.validFrom)} – {r.validTo ? d(r.validTo) : "hazırda"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{formatAzn(Number(r.baseSalary))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
