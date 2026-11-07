import { notFound } from "next/navigation";
import { OriginalQr } from "@/components/print/original-qr";
import { KV, PrintBar, PrintTable, Sheet, SheetSection } from "@/components/print/print-bar";
import { formatYmd } from "@/lib/calc/seniority";
import { salaryAccessFor } from "@/lib/auth/salary-access";
import { canAccessPerson } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { DOCUMENT_KINDS } from "@/lib/document-types";
import { ORG_NAME, ORG_UNIT } from "@/lib/org";
import { buildPersonalIndex, INDEX_SECTION_LABELS } from "@/lib/personal-file";
import { absoluteUrl } from "@/lib/qr";
import { getDossier, STAFF_CATEGORY_LABELS } from "@/lib/queries";
import { SALARY_HIDDEN_LABEL } from "@/lib/salary-privacy";
import { UNKNOWN_LABEL } from "@/lib/unknown-values";
import { formatAzn, formatDateTime } from "@/lib/utils";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Şəxsi işin tam çapı" };

const d = (v: Date | null | undefined) => (v ? formatAzDate(v) : "");

/** Şəxsi işin tam çapı (TZ M05-01): şəxsi məlumat, müqavilələr, vahid indeks, sənədlər (yoxlanılma ilə), tanışlıq qeydləri */
export default async function PersonalFilePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.edit");
  const { id } = await params;
  const salary = await salaryAccessFor(user, id);
  const data = await getDossier(id, { hideSalary: !salary.visible });
  if (!data || data.person.deletedAt || !(await canAccessPerson(user, id))) notFound();
  const { person: p, seniority } = data;
  await audit({ user, action: "PRINT", entity: "Person", entityId: p.id, summary: `Şəxsi işin tam çapı açıldı: ${p.fullName} (${p.code})` });
  const index = buildPersonalIndex(p);
  const acks = p.employments.flatMap((e) => e.jobDescriptionAcks.map((a) => ({ ...a, employment: `${e.position.name} · ${e.department.name}` })));
  return (
    <>
      <PrintBar backHref={`/employees/${p.id}?tab=documents`} />
      <Sheet>
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-800 pb-3">
          <div>
            <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
              {ORG_NAME} · {ORG_UNIT}
            </div>
            <h1 className="mt-1 text-[18px] font-bold">Şəxsi iş</h1>
            <div className="text-[15px] font-semibold">{p.fullName}</div>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-right text-[11px] text-neutral-600">
              <div>
                Kod: <b className="font-mono text-neutral-900">{p.code}</b>
              </div>
              <div>FİN: {p.fin}</div>
              <div>Çap: {formatDateTime(new Date())}</div>
            </div>
            <OriginalQr url={await absoluteUrl(`/employees/${p.id}`)} label="Dosyenin orijinalı" />
          </div>
        </header>

        <SheetSection title="Şəxsi məlumatlar">
          <KV
            rows={[
              ["Doğum tarixi", d(p.birthDate)],
              ["Cinsi", p.gender === "MALE" ? "Kişi" : "Qadın"],
              ["Şəxsiyyət vəsiqəsi", p.idDocNumber ? [p.idDocType, p.idDocSeries, p.idDocNumber].filter(Boolean).join(" ") : UNKNOWN_LABEL],
              ["Verilib", [d(p.idDocIssueDate), p.idDocIssuedBy].filter(Boolean).join(" · ")],
              ["Telefon", p.mobilePhone],
              ["Ünvan", p.registeredAddress],
              ["Ümumi əmək stajı", seniority.basis === "unknown" ? UNKNOWN_LABEL : `${formatYmd(seniority.total)}${seniority.basis === "opening" ? ` (${seniority.openingNote})` : ""}`],
              ["Vətəndaşlıq", p.citizenship],
            ]}
          />
        </SheetSection>

        <SheetSection title="Müqavilələr və təyinatlar">
          <PrintTable
            head={["Bölmə", "Vəzifə", "Heyət", "İşə qəbul", "Müqavilə", "Ştat", "Oklad", "Status"]}
            rows={p.employments.map((e) => [
              e.department.name,
              e.position.name,
              STAFF_CATEGORY_LABELS[e.position.staffCategory],
              e.hireDate ? d(e.hireDate) : UNKNOWN_LABEL,
              e.contractType === "MUDDETLI" ? `müddətli${e.contractEndDate ? ` · ${d(e.contractEndDate)}` : ""}` : e.contractType === "MUDDETSIZ" ? "müddətsiz" : "",
              Number(e.unitShare).toLocaleString("en-US"),
              data.salaryHidden ? SALARY_HIDDEN_LABEL : e.salaryUnknown ? UNKNOWN_LABEL : e.baseSalary === null ? "" : formatAzn(Number(e.baseSalary)),
              e.status === "TERMINATED" ? `Azad ${d(e.terminationDate)}${e.terminationArticle ? ` · ƏM ${e.terminationArticle}` : ""}` : e.status === "ON_LEAVE" ? "Məzuniyyətdə" : "Aktiv",
            ])}
          />
        </SheetSection>

        <SheetSection title="Vahid xronoloji indeks">
          <PrintTable head={["Tarix", "Bölmə", "Qeyd", "Məzmun"]} rows={index.map((r) => [r.date ? d(r.date) : UNKNOWN_LABEL, INDEX_SECTION_LABELS[r.section], r.title, r.detail])} />
        </SheetSection>

        <SheetSection title="Şəxsi iş sənədləri">
          <PrintTable
            head={["Növ", "Ad", "Nömrə", "Tarix", "Yoxlanılıb"]}
            empty="Sənəd yoxdur"
            rows={p.documents.map((x) => [DOCUMENT_KINDS[x.kind], x.title, x.number, d(x.documentDate), x.verifiedAt ? `${d(x.verifiedAt)} · ${x.verifiedBy?.fullName ?? ""}` : "xeyr"])}
          />
        </SheetSection>

        <SheetSection title="Vəzifə təlimatı ilə tanışlıq">
          <PrintTable
            head={["Təyinat", "Təlimat", "Səbəb", "Tapşırıq", "Tanış olub"]}
            empty="Tanışlıq tapşırığı yoxdur"
            rows={acks.map((a) => [a.employment, `${a.jobDescription.title} · v${a.jobDescription.version}`, a.reason, d(a.assignedAt), a.acknowledgedAt ? d(a.acknowledgedAt) : "tanış deyil"])}
          />
        </SheetSection>
      </Sheet>
    </>
  );
}
