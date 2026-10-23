import { notFound } from "next/navigation";
import { KV, PrintBar, PrintTable, Sheet, SheetSection } from "@/components/print/print-bar";
import { formatYmd } from "@/lib/calc/seniority";
import { canAccessPerson } from "@/lib/auth/scope";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { APP_NAME, ORG_NAME, ORG_UNIT } from "@/lib/org";
import { getDossier, STAFF_CATEGORY_LABELS } from "@/lib/queries";
import { formatAzn, formatDateTime } from "@/lib/utils";
import { formatAzDate } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Şəxsi vərəqə — çap" };

const d = (v: Date | null | undefined) => (v ? formatAzDate(v) : "");
const STATUS = { ACTIVE: "Aktiv", ON_LEAVE: "Məzuniyyətdə", TERMINATED: "Azad olunub" } as const;
const MARITAL = { SINGLE: "Subay", MARRIED: "Evli", DIVORCED: "Boşanmış", WIDOWED: "Dul" } as const;
const PROFICIENCY = { EXCELLENT: "əla", GOOD: "yaxşı", SATISFACTORY: "kafi" } as const;

export default async function PrintPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employees.view");
  const { id } = await params;
  const data = await getDossier(id);
  if (!data || data.person.deletedAt || !(await canAccessPerson(user, id))) notFound();
  const { person: p, main, seniority, leave } = data;

  await audit({ user, action: "PRINT", entity: "Person", entityId: p.id, summary: `Şəxsi vərəqə çap üçün açıldı: ${p.fullName} (${p.code})` });

  return (
    <>
      <PrintBar backHref={`/employees/${p.id}`} />
      <Sheet>
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-800 pb-3">
          <div>
            <div className="text-[11px] tracking-wider text-neutral-500 uppercase">{ORG_NAME} · {ORG_UNIT}</div>
            <h1 className="mt-1 text-[18px] font-bold">Əməkdaşın şəxsi vərəqəsi</h1>
          </div>
          <div className="text-right text-[11px] text-neutral-600">
            <div>
              Kod: <b className="font-mono text-neutral-900">{p.code}</b>
            </div>
            <div>Tarix: {formatDateTime(new Date())}</div>
          </div>
        </header>

        <div className="mt-4">
          <div className="text-[16px] font-semibold">{p.fullName}</div>
          {main && (
            <div className="text-neutral-600">
              {main.position.name} · {main.department.name} · {STATUS[main.status]}
            </div>
          )}
        </div>

        <SheetSection title="Şəxsi məlumatlar">
          <KV
            rows={[
              ["Soyadı", p.lastName],
              ["Adı", p.firstName],
              ["Atasının adı", p.patronymic],
              ["Cinsi", p.gender === "MALE" ? "Kişi" : "Qadın"],
              ["Doğum tarixi", d(p.birthDate)],
              ["Doğulduğu yer", [p.birthCountry, p.birthDistrict, p.birthCity].filter(Boolean).join(", ")],
              ["Ailə vəziyyəti", p.maritalStatus ? MARITAL[p.maritalStatus] : ""],
              ["Vətəndaşlığı", p.citizenship],
            ]}
          />
        </SheetSection>

        <SheetSection title="Şəxsiyyəti təsdiq edən sənəd və əlaqə">
          <KV
            rows={[
              ["Sənəd", [p.idDocType, p.idDocSeries, p.idDocNumber].filter(Boolean).join(" ")],
              ["FİN", <span key="fin" className="font-mono">{p.fin}</span>],
              ["Verilib", [d(p.idDocIssueDate), p.idDocIssuedBy].filter(Boolean).join(", ")],
              ["SSN", p.ssn],
              ["Mobil telefon", p.mobilePhone],
              ["Xidməti telefon", p.workPhone],
              ["E-poçt", p.email],
              ["Qeydiyyat ünvanı", p.registeredAddress],
              ["Faktiki ünvan", p.livingAddress],
            ]}
          />
        </SheetSection>

        <SheetSection title="Əmək müqavilələri">
          <PrintTable
            head={["Struktur bölmə", "Vəzifə", "Heyət", "İşə qəbul", "Ştat", "Oklad", "Status"]}
            rows={p.employments.map((e) => [
              e.department.name,
              e.position.name,
              STAFF_CATEGORY_LABELS[e.position.staffCategory],
              d(e.hireDate),
              Number(e.unitShare).toLocaleString("en-US"),
              formatAzn(Number(e.baseSalary)),
              e.status === "TERMINATED" ? `Azad olunub ${d(e.terminationDate)}` : STATUS[e.status],
            ])}
          />
          <div className="mt-2">
            <KV
              rows={[
                ["Ümumi əmək stajı", formatYmd(seniority.total)],
                ["Müəssisədə staj", formatYmd(seniority.service)],
                ["Məzuniyyət hüququ (cari il)", leave ? `${leave.total} təqvim günü` : ""],
                ["Vergi güzəşti", p.taxExemptionClause],
              ]}
            />
          </div>
        </SheetSection>

        <SheetSection title="Təhsil">
          <PrintTable
            head={["Növü", "Təhsil müəssisəsi", "İxtisas", "Bitirmə", "Diplom"]}
            rows={p.educations.map((e) => [e.educationType, e.institution, e.specialty, d(e.graduationDate), e.diplomaSeriesNumber])}
          />
        </SheetSection>

        {(p.academicDegrees.length > 0 || p.academicTitles.length > 0) && (
          <SheetSection title="Elmi dərəcə və elmi ad">
            <PrintTable
              head={["Dərəcə / ad", "Sahə / istiqamət", "Verilmə tarixi", "Sənəd"]}
              rows={[
                ...p.academicDegrees.map((g) => [g.degreeName, g.field, d(g.awardDate), g.diplomaSeriesNumber]),
                ...p.academicTitles.map((t) => [t.titleName, t.direction, d(t.awardDate), [t.attestatSeries, t.diplomaNumber].filter(Boolean).join(" ")]),
              ]}
            />
          </SheetSection>
        )}

        <SheetSection title="Əvvəlki iş yerləri">
          <PrintTable
            head={["Təşkilat", "Vəzifə", "Başlama", "Bitmə", "Səbəb"]}
            rows={p.workHistory.map((w) => [w.organization, w.position, d(w.startDate), d(w.endDate), [w.laborCodeArticle && `ƏM ${w.laborCodeArticle}`, w.terminationReason].filter(Boolean).join(" · ")])}
          />
        </SheetSection>

        <SheetSection title="Ailə üzvləri">
          <PrintTable head={["Qohumluq", "Soyadı, adı, atasının adı", "Doğum tarixi", "İş yeri, vəzifə"]} rows={p.familyMembers.map((f) => [f.relation, f.fullName, d(f.birthDate), [f.workplace, f.position].filter(Boolean).join(", ")])} />
        </SheetSection>

        {p.languages.length > 0 && (
          <SheetSection title="Dil bilikləri">
            <p>{p.languages.map((l) => `${l.language} (${PROFICIENCY[l.level]})`).join(", ")}</p>
          </SheetSection>
        )}

        <footer className="mt-8 grid grid-cols-2 gap-10 text-[11px] break-inside-avoid">
          <div>
            <div className="mb-6">Kadrlar şöbəsinin əməkdaşı:</div>
            <div className="border-t border-neutral-500 pt-1 text-neutral-500">(imza, ad, soyad)</div>
          </div>
          <div>
            <div className="mb-6">Əməkdaş:</div>
            <div className="border-t border-neutral-500 pt-1 text-neutral-500">(imza)</div>
          </div>
          <div className="col-span-2 text-neutral-500">
            Çap edən: {user.fullName} (@{user.username}) · {APP_NAME} · {formatDateTime(new Date())}
          </div>
        </footer>
      </Sheet>
    </>
  );
}
