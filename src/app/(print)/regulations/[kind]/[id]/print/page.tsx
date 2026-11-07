import { notFound } from "next/navigation";
import { OriginalQr } from "@/components/print/original-qr";
import { KV, PrintBar, Sheet, SheetSection } from "@/components/print/print-bar";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { ORG_NAME, ORG_UNIT } from "@/lib/org";
import { absoluteUrl } from "@/lib/qr";
import { getRegulationDTO } from "@/lib/regulation-dto";
import { REGULATION_TEXT_FIELDS, REGULATION_TITLES, regulationHref, type RegulationKind } from "@/lib/regulation-fields";
import { REGULATION_STATUS_LABELS } from "@/lib/regulations";
import { formatDateTime, formatIsoDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Çap" };

export default async function PrintRegulationPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await requireUser("employees.view");
  const { kind: k, id } = await params;
  if (k !== "charter" && k !== "jd") notFound();
  const kind = k as RegulationKind;
  const data = await getRegulationDTO(kind, id);
  if (!data) notFound();
  await audit({ user, action: "PRINT", entity: kind === "charter" ? "DepartmentCharter" : "JobDescription", entityId: id, summary: `${REGULATION_TITLES[kind].one} v${data.version} çap üçün açıldı: ${data.title}` });
  const approved = data.status === "TESDIQLENIB" || data.status === "QUVVEDEN_DUSUB";
  return (
    <>
      <PrintBar backHref={regulationHref(kind, id)} />
      <Sheet>
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-800 pb-3">
          <div>
            <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
              {ORG_NAME} · {ORG_UNIT}
            </div>
            <h1 className="mt-1 text-[18px] font-bold">{data.title}</h1>
            <div className="text-neutral-600">{data.owner.label}</div>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-right text-[11px] text-neutral-600">
              <div>
                Versiya: <b>v{data.version}</b> · {REGULATION_STATUS_LABELS[data.status]}
              </div>
              <div>Çap: {formatDateTime(new Date())}</div>
            </div>
            <OriginalQr url={await absoluteUrl(regulationHref(kind, id))} label="Orijinal" />
          </div>
        </header>
        {!approved && <p className="mt-3 border border-neutral-400 px-2 py-1 text-center text-[11px] font-semibold uppercase">Layihə — təsdiqlənməyib</p>}
        {approved && (
          <div className="mt-3 text-right text-[12px]">
            <div className="font-semibold">TƏSDİQ EDİRƏM</div>
            <div>{data.approvedBy}</div>
            <div>
              {formatIsoDate(data.approvedOn)}
              {data.orderNumber ? ` · əmr № ${data.orderNumber}` : ""}
            </div>
          </div>
        )}
        {REGULATION_TEXT_FIELDS[kind].map((f) => (
          <SheetSection key={f.key} title={f.label}>
            <div className="whitespace-pre-wrap">{data.texts[f.key] || "—"}</div>
          </SheetSection>
        ))}
        <SheetSection title="Sənədin həyat dövrü">
          <KV
            rows={[
              ["Status", REGULATION_STATUS_LABELS[data.status]],
              ["Qüvvədədir", data.effectiveFrom ? `${formatIsoDate(data.effectiveFrom)}${data.effectiveTo ? ` – ${formatIsoDate(data.effectiveTo)}` : ""}` : ""],
              ["Hüquqi rəy", data.legalReviewDate ? `${formatIsoDate(data.legalReviewDate)} · ${data.legalReviewBy ?? ""}` : ""],
              ...(kind === "charter" ? ([["Növbəti baxış", formatIsoDate(data.nextReviewOn)]] as [string, string][]) : []),
            ]}
          />
        </SheetSection>
        {kind === "jd" && (
          <SheetSection title="Tanış oldum">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Soyadı, adı, ata adı", "Tarix", "İmza"].map((h) => (
                    <th key={h} className="border border-neutral-400 bg-neutral-100 px-1.5 py-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 4 }, (_, i) => (
                  <tr key={i}>
                    <td className="h-7 border border-neutral-400" />
                    <td className="border border-neutral-400" />
                    <td className="border border-neutral-400" />
                  </tr>
                ))}
              </tbody>
            </table>
          </SheetSection>
        )}
      </Sheet>
    </>
  );
}
