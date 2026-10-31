import {
  BanknoteIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalendarClockIcon,
  CalendarIcon,
  FolderOpenIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  IdCardIcon,
  MailIcon,
  MapPinIcon,
  PalmtreeIcon,
  PhoneIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react";
import type * as React from "react";
import { PersonDocuments } from "@/components/employee/documents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatYmd } from "@/lib/calc/seniority";
import { STAFF_CATEGORY_LABELS, type Dossier } from "@/lib/queries";
import { cn, formatAzn, formatNumber, initials } from "@/lib/utils";
import { formatAzDate } from "@/lib/validation/primitives";

// ----------------------------------------------------------------------------
//  Köməkçi komponentlər
// ----------------------------------------------------------------------------

const d = (v: Date | null | undefined) => (v ? formatAzDate(v) : "—");
const n = (v: unknown) => Number(v);

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm", mono && "font-mono")}>{value === null || value === undefined || value === "" ? "—" : value}</dd>
    </div>
  );
}

function Section({ title, description, icon: Icon, children, className }: { title: string; description?: string; icon?: typeof UserIcon; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center gap-2">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-4">{children}</dl>;
}

function SimpleTable<T>({ rows, columns, empty = "Məlumat yoxdur" }: { rows: T[]; columns: { header: string; cell: (r: T) => React.ReactNode; className?: string }[]; empty?: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
            {columns.map((c) => (
              <th key={c.header} className={cn("px-5 py-2 font-medium whitespace-nowrap", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {columns.map((c) => (
                <td key={c.header} className={cn("px-5 py-2.5", c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "warning" | "danger" | "primary" }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "primary" && "text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

const STATUS = {
  ACTIVE: { label: "Aktiv", variant: "success" },
  ON_LEAVE: { label: "Məzuniyyətdə", variant: "warning" },
  TERMINATED: { label: "Azad olunub", variant: "danger" },
} as const;

const ABSENCE_LABEL = {
  SICK: { label: "Xəstəlik", variant: "outline" },
  UNKNOWN: { label: "Naməlum səbəb", variant: "danger" },
  SOCIAL_PAID: { label: "Sosial məzuniyyət (sm)", variant: "warning" },
  SOCIAL_UNPAID: { label: "Ödənişsiz sosial məzuniyyət (ö/sm)", variant: "warning" },
  UNPAID: { label: "Ödənişsiz məzuniyyət (ö/m)", variant: "danger" },
} as const;
const PROFICIENCY = { EXCELLENT: "əla", GOOD: "yaxşı", SATISFACTORY: "kafi" } as const;
const DEGREE_LABEL = { PHD: "Fəlsəfə doktoru", DSC: "Elmlər doktoru" } as const;
const TITLE_LABEL = { DOCENT: "Dosent", PROFESSOR: "Professor", CORRESPONDING_MEMBER: "AMEA müxbir üzvü", ACADEMICIAN: "AMEA həqiqi üzvü" } as const;
const AWARD_LABEL = { HONORARY_TITLE: "Fəxri ad", STATE_AWARD: "Dövlət təltifi", PRIZE: "Mükafat" } as const;
const DISABILITY_LABEL = { GROUP_1: "I qrup", GROUP_2: "II qrup", GROUP_3: "III qrup", CHILD_UNDER_18: "18 yaşadək" } as const;
const MARITAL = { SINGLE: "Subay", MARRIED: "Evli", DIVORCED: "Boşanmış", WIDOWED: "Dul" } as const;

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;

// ----------------------------------------------------------------------------
//  Dosye
// ----------------------------------------------------------------------------

const TABS = ["personal", "contract", "academic", "family", "leave", "attendance", "documents"];

/** tab — açılışda seçilən bölmə (?tab=documents); canEdit — şəxsi işə sənəd yükləmək; canDelete — sənədi sorğusuz silmək */
export function EmployeeDossier({ data, canEdit = false, canDelete = false, tab }: { data: Dossier; canEdit?: boolean; canDelete?: boolean; tab?: string }) {
  const { person: p, main, seniority, leave, payroll, carryover } = data;
  const status = main ? STATUS[main.status] : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Başlıq */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/20 via-primary/5 to-transparent" />
        <CardContent className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl border-4 border-card bg-primary text-2xl font-semibold text-primary-foreground shadow-md">
            {initials(p.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{p.fullName}</h1>
              {status && <Badge variant={status.variant}>{status.label}</Badge>}
              {p.academicTitles.map((t) => (
                <Badge key={t.id}>{TITLE_LABEL[t.title]}</Badge>
              ))}
              {p.academicDegrees.map((g) => (
                <Badge key={g.id} variant="outline">
                  {DEGREE_LABEL[g.degree]}
                </Badge>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {main && (
                <span className="flex items-center gap-1.5">
                  <BriefcaseIcon className="size-3.5" />
                  {main.position.name} · {main.department.name}
                </span>
              )}
              <span className="flex items-center gap-1.5 font-mono text-xs">
                <IdCardIcon className="size-3.5" />
                {p.code} · FİN {p.fin}
              </span>
              {p.mobilePhone && (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="size-3.5" />
                  {p.mobilePhone}
                </span>
              )}
              {p.email && (
                <span className="flex items-center gap-1.5">
                  <MailIcon className="size-3.5" />
                  {p.email}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:w-[440px]">
            <Stat label="Ümumi staj" value={`${seniority.total.years} il`} tone="primary" />
            <Stat label="Məzuniyyət hüququ" value={leave ? `${leave.total} gün` : "—"} tone="success" />
            <Stat label="Netto maaş" value={payroll ? formatAzn(payroll.net) : "—"} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={tab && TABS.includes(tab) ? tab : "personal"}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="personal">
            <UserIcon /> Şəxsi
          </TabsTrigger>
          <TabsTrigger value="contract">
            <BanknoteIcon /> Müqavilə və maaş
          </TabsTrigger>
          <TabsTrigger value="academic">
            <GraduationCapIcon /> Akademik portfolio
          </TabsTrigger>
          <TabsTrigger value="family">
            <HeartHandshakeIcon /> Ailə və hərbi
          </TabsTrigger>
          <TabsTrigger value="leave">
            <PalmtreeIcon /> Məzuniyyət
          </TabsTrigger>
          <TabsTrigger value="attendance">
            <CalendarClockIcon /> Davamiyyət
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FolderOpenIcon /> Şəxsi iş
            {p.documents.length > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary tabular-nums">{p.documents.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* ŞƏXSİ */}
        <TabsContent value="personal" className="flex flex-col gap-4">
          <Section title="Şəxsi məlumatlar" icon={UserIcon}>
            <Fields>
              <Field label="Cinsi" value={p.gender === "MALE" ? "Kişi" : "Qadın"} />
              <Field label="Doğum tarixi" value={d(p.birthDate)} />
              <Field label="Doğum yeri" value={[p.birthCity, p.birthDistrict, p.birthCountry].filter(Boolean).join(", ")} />
              <Field label="Ailə vəziyyəti" value={p.maritalStatus ? MARITAL[p.maritalStatus] : null} />
              <Field label="Vətəndaşlığı" value={p.citizenship} />
              <Field label="Milliyyəti" value={p.nationality} />
              <Field label="Sosial mənşəyi" value={p.socialOrigin} />
              <Field label="Məcburi köçkün / qaçqın" value={p.isIdpOrRefugee ? "Bəli" : "Xeyr"} />
            </Fields>
          </Section>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Şəxsiyyəti təsdiq edən sənəd" icon={IdCardIcon}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Sənəd" value={p.idDocType} />
                <Field label="Seriya / nömrə" value={`${p.idDocSeries ?? ""} ${p.idDocNumber}`.trim()} mono />
                <Field label="Verilmə tarixi" value={d(p.idDocIssueDate)} />
                <Field label="Verən orqan" value={p.idDocIssuedBy} />
                <Field label="FİN kod" value={p.fin} mono />
                <Field label="Sosial sığorta nömrəsi" value={p.ssn} mono />
              </dl>
            </Section>
            <Section title="Əlaqə və ünvan" icon={MapPinIcon}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Mobil telefon" value={p.mobilePhone} />
                <Field label="Xidməti telefon" value={p.workPhone} />
                <Field label="E-poçt" value={p.email} />
                <Field label="Qeydiyyat ünvanı" value={p.registeredAddress} />
                <Field label="Faktiki ünvan" value={p.livingAddress} />
              </dl>
            </Section>
          </div>
          {p.isForeigner && (
            <Section title="Əcnəbi məlumatları">
              <Fields>
                <Field label="Pasportun seriya və nömrəsi" value={p.passportNumber} mono />
                <Field label="Pasport" value={`${d(p.passportIssueDate)} – ${d(p.passportExpiry)}`} />
                <Field label="Viza" value={p.visaNumber} mono />
                <Field label="Viza müddəti" value={`${d(p.visaIssueDate)} – ${d(p.visaExpiryDate)}`} />
                <Field label="Gəliş tarixi" value={d(p.arrivalDate)} />
              </Fields>
            </Section>
          )}
          <Section title="Əvvəlki əmək fəaliyyəti" icon={BriefcaseIcon}>
            <SimpleTable
              rows={p.workHistory}
              columns={[
                { header: "Müəssisə", cell: (r) => r.organization },
                { header: "Vəzifə", cell: (r) => r.position },
                { header: "Dövr", cell: (r) => `${d(r.startDate)} – ${d(r.endDate)}`, className: "whitespace-nowrap tabular-nums" },
                {
                  header: "Staj",
                  cell: (r) => (
                    <div className="flex gap-1">
                      {r.countsScientific && <Badge variant="outline">Elmi</Badge>}
                      {r.countsScientificPedagog && <Badge variant="outline">Elmi-pedaqoji</Badge>}
                      {r.countsUnec && <Badge variant="outline">ASOİU</Badge>}
                    </div>
                  ),
                },
                { header: "Xitam", cell: (r) => [r.laborCodeArticle && `ƏM ${r.laborCodeArticle}`, r.terminationReason].filter(Boolean).join(" · ") || "—" },
              ]}
            />
          </Section>
          <Section title="Təhsil və dillər" icon={BookOpenIcon}>
            <SimpleTable
              rows={p.educations}
              columns={[
                { header: "Növü", cell: (r) => <span className="capitalize">{r.educationType}</span> },
                {
                  header: "Müəssisə",
                  cell: (r) => (
                    <span className="flex items-center gap-1.5">
                      {r.institution}
                      {r.isAbroad && <Badge variant="outline">xaricdə</Badge>}
                    </span>
                  ),
                },
                { header: "İxtisas", cell: (r) => [r.specialty, r.specialization].filter(Boolean).join(" · ") || "—" },
                { header: "Forma", cell: (r) => r.studyForm ?? "—" },
                { header: "Dövr", cell: (r) => `${r.startDate?.getUTCFullYear() ?? "—"} – ${r.graduationDate?.getUTCFullYear() ?? "—"}`, className: "tabular-nums whitespace-nowrap" },
                { header: "Diplom", cell: (r) => r.diplomaSeriesNumber ?? "—", className: "font-mono text-xs" },
              ]}
            />
            {(p.languages.length > 0 || p.skills.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {p.languages.map((l) => (
                  <Badge key={l.id} variant="outline">
                    {l.language} · {PROFICIENCY[l.level]}
                  </Badge>
                ))}
                {p.skills.map((s) => (
                  <Badge key={s.id} variant={s.kind === "SOFTWARE" ? "default" : "outline"}>
                    {s.name}
                    {s.proficiency && ` · ${PROFICIENCY[s.proficiency]}`}
                  </Badge>
                ))}
              </div>
            )}
          </Section>
          {(p.partyMemberships.length > 0 || p.electedOrgans.length > 0 || p.legalLiabilities.length > 0) && (
            <Section title="İctimai-siyasi və hüquqi məlumatlar" icon={ShieldIcon}>
              <SimpleTable
                rows={[
                  ...p.partyMemberships.map((x) => ({
                    kind: "Partiya mənsubluğu",
                    name: x.isMember ? [x.party, x.cardNumber && `bilet № ${x.cardNumber}`].filter(Boolean).join(" · ") : "Partiya üzvü deyil",
                    period: d(x.cardIssueDate),
                  })),
                  ...p.electedOrgans.map((x) => ({
                    kind: "Seçki orqanı",
                    name: [x.organName, x.position, x.location].filter(Boolean).join(" · "),
                    period: `${d(x.electedDate)} – ${d(x.exitDate)}`,
                  })),
                  ...p.legalLiabilities.map((x) => ({ kind: "Məhkəmə məsuliyyəti", name: x.reason, period: d(x.date) })),
                ]}
                columns={[
                  { header: "Növ", cell: (r) => r.kind },
                  { header: "Məzmun", cell: (r) => r.name },
                  { header: "Tarix", cell: (r) => r.period, className: "tabular-nums whitespace-nowrap" },
                ]}
              />
            </Section>
          )}
        </TabsContent>

        {/* MÜQAVİLƏ VƏ MAAŞ */}
        <TabsContent value="contract" className="flex flex-col gap-4">
          <Section title="Əmək müqavilələri" icon={BriefcaseIcon}>
            <SimpleTable
              rows={p.employments}
              columns={[
                { header: "Vəzifə", cell: (r) => <span className="font-medium">{r.position.name}</span> },
                { header: "Bölmə", cell: (r) => r.department.name },
                { header: "Heyət", cell: (r) => STAFF_CATEGORY_LABELS[r.position.staffCategory] },
                { header: "Ödəniş forması", cell: (r) => r.paymentForm },
                { header: "Qəbul", cell: (r) => d(r.hireDate), className: "tabular-nums" },
                { header: "Ştat", cell: (r) => n(r.unitShare).toFixed(2), className: "tabular-nums" },
                { header: "Oklad", cell: (r) => formatAzn(n(r.baseSalary)), className: "tabular-nums text-right" },
                {
                  header: "Status",
                  cell: (r) => (
                    <div className="flex flex-col gap-0.5">
                      <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                      {r.terminationDate && (
                        <span className="text-[11px] text-muted-foreground">
                          {d(r.terminationDate)} · ƏM {r.terminationArticle}
                        </span>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Section>
          {payroll && main && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Section title="Hesablama" description={`${main.position.name} · ${main.schedule}`} className="lg:col-span-2">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <PayrollList title="Hesablanıb" lines={payroll.earnings} total={payroll.gross} totalLabel="Brutto" />
                  <PayrollList title="Tutulmalar" lines={payroll.deductions} total={payroll.totalDeductions} totalLabel="Cəmi tutulma" negative />
                </div>
                <div className="mt-6 flex items-center justify-between rounded-lg bg-success-soft px-4 py-3">
                  <span className="text-sm font-medium text-success">Ödəniləcək (netto)</span>
                  <span className="text-2xl font-semibold text-success tabular-nums">{formatAzn(payroll.net)}</span>
                </div>
                {p.taxExemptionClause && <p className="mt-2 text-xs text-muted-foreground">Vergi güzəşti: VM {p.taxExemptionClause}</p>}
              </Section>
              <Section title="İşəgötürən xərci" description="Əməkhaqqı fonduna əlavə ödənişlər">
                <PayrollList title="" lines={payroll.employerContributions} total={payroll.employerCost} totalLabel="Ümumi xərc" />
              </Section>
            </div>
          )}
          {main && main.salaryHistory.length > 0 && (
            <Section title="Oklad tarixçəsi" icon={CalendarIcon}>
              <SimpleTable
                rows={main.salaryHistory}
                columns={[
                  { header: "Dövr", cell: (r) => `${d(r.validFrom)} – ${r.validTo ? d(r.validTo) : "hazırda"}`, className: "tabular-nums" },
                  { header: "Oklad", cell: (r) => formatAzn(n(r.baseSalary)), className: "tabular-nums text-right" },
                ]}
              />
            </Section>
          )}
        </TabsContent>

        {/* AKADEMİK PORTFOLİO */}
        <TabsContent value="academic" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Nəşrlər" value={p.publications.length} tone="primary" />
            <Stat label="Layihə / qrant" value={p.projects.length} />
            <Stat label="Patent / sertifikat" value={p.intellectualProps.length} />
            <Stat label="Tədbirlər" value={p.events.length} />
            <Stat label="Tədqiqat mövzusu" value={p.researchTopics.length} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Elmi dərəcə və adlar" icon={GraduationCapIcon}>
              <SimpleTable
                rows={[
                  ...p.academicDegrees.map((x) => ({ name: x.degreeName, field: x.field, date: x.awardDate, doc: x.diplomaSeriesNumber, by: x.issuingInstitution })),
                  ...p.academicTitles.map((x) => ({
                    name: x.titleName,
                    field: x.direction,
                    date: x.awardDate,
                    doc: [x.attestatSeries, x.diplomaNumber].filter(Boolean).join(" ") || null,
                    by: x.issuingInstitution,
                  })),
                ]}
                columns={[
                  { header: "Ad", cell: (r) => <span className="font-medium">{r.name}</span> },
                  { header: "Sahə", cell: (r) => r.field ?? "—" },
                  { header: "Tarix", cell: (r) => d(r.date), className: "tabular-nums" },
                  { header: "Sənəd", cell: (r) => r.doc ?? "—", className: "font-mono text-xs" },
                  { header: "Verən müəssisə", cell: (r) => r.by ?? "—" },
                ]}
              />
            </Section>
            <Section title="Təltiflər">
              <SimpleTable
                rows={p.awards}
                columns={[
                  { header: "Növ", cell: (r) => <Badge variant="outline">{AWARD_LABEL[r.kind]}</Badge> },
                  { header: "Ad", cell: (r) => r.name },
                  { header: "Tarix", cell: (r) => d(r.awardDate), className: "tabular-nums" },
                  { header: "Əmr", cell: (r) => r.orderNumber ?? "—", className: "font-mono text-xs" },
                  { header: "Verən", cell: (r) => r.issuedBy ?? "—" },
                ]}
              />
            </Section>
          </div>
          <Section title="Əməkdaşın əsərləri" icon={BookOpenIcon}>
            <SimpleTable
              rows={p.publications}
              columns={[
                { header: "Əsərin adı", cell: (r) => <span className="font-medium">{r.title}</span> },
                { header: "Mövzu", cell: (r) => r.topic ?? "—" },
                { header: "Nəşr tarixi", cell: (r) => d(r.publishedDate), className: "tabular-nums" },
                { header: "Şərh", cell: (r) => r.comment ?? "—" },
              ]}
            />
          </Section>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Layihələr və qrantlar">
              <SimpleTable
                rows={p.projects}
                columns={[
                  { header: "Layihə", cell: (r) => r.title },
                  { header: "Qrant", cell: (r) => (r.grantAmount ? formatAzn(n(r.grantAmount)) : "—"), className: "tabular-nums whitespace-nowrap" },
                  { header: "Dövr", cell: (r) => `${d(r.startDate)} – ${d(r.endDate)}`, className: "tabular-nums whitespace-nowrap" },
                  { header: "Şərh", cell: (r) => r.comment ?? "—" },
                ]}
              />
            </Section>
            <Section title="Patent və şəhadətnamələr">
              <SimpleTable
                rows={p.intellectualProps}
                columns={[
                  { header: "İxtira", cell: (r) => r.inventionName },
                  { header: "Patent", cell: (r) => [r.patentName, r.patentNumber && `№ ${r.patentNumber}`, r.patentDate && d(r.patentDate)].filter(Boolean).join(" · ") || "—" },
                  {
                    header: "Şəhadətnamə",
                    cell: (r) => [r.certificateName, r.certificateNumber && `№ ${r.certificateNumber}`, r.certificateDate && d(r.certificateDate)].filter(Boolean).join(" · ") || "—",
                  },
                ]}
              />
            </Section>
            <Section title="Tədbirlərdə iştirak">
              <SimpleTable
                rows={p.events}
                columns={[
                  { header: "Növü", cell: (r) => r.eventType },
                  { header: "Mövzu", cell: (r) => r.topic ?? "—" },
                  { header: "Tarix", cell: (r) => d(r.date), className: "tabular-nums" },
                  { header: "Şərh", cell: (r) => r.comment ?? "—" },
                ]}
              />
            </Section>
            <Section title="Elmi tədqiqatlar və attestasiya">
              <SimpleTable
                rows={p.researchTopics}
                columns={[
                  { header: "Mövzu", cell: (r) => r.topic },
                  { header: "Bölgü / sahə", cell: (r) => [r.category, r.domain].filter(Boolean).join(" · ") || "—" },
                  { header: "Dövr", cell: (r) => `${d(r.startDate)} – ${d(r.endDate)}`, className: "tabular-nums whitespace-nowrap" },
                ]}
              />
              {p.attestations.length > 0 && (
                <div className="mt-4">
                  <SimpleTable
                    rows={p.attestations}
                    columns={[
                      { header: "Attestasiya", cell: (r) => d(r.date), className: "tabular-nums" },
                      { header: "Nəticə", cell: (r) => r.result },
                      { header: "Əmr", cell: (r) => [r.orderNumber, r.orderDate && d(r.orderDate)].filter(Boolean).join(" · ") || "—" },
                    ]}
                  />
                </div>
              )}
            </Section>
          </div>
        </TabsContent>

        {/* AİLƏ VƏ HƏRBİ */}
        <TabsContent value="family" className="flex flex-col gap-4">
          <Section title="Ailə üzvləri" description="Qeydiyyat tarixi: uşaq işə qəbuldan sonra doğulubsa — doğum tarixi, əks halda — işə qəbul tarixi" icon={HeartHandshakeIcon}>
            <SimpleTable
              rows={p.familyMembers}
              columns={[
                { header: "S.A.A.", cell: (r) => <span className="font-medium">{r.fullName}</span> },
                {
                  header: "Qohumluq",
                  cell: (r) => (
                    <span className="flex items-center gap-1.5 capitalize">
                      {r.relation}
                      {r.isDisabledChild && <Badge variant="warning">əlil uşaq</Badge>}
                    </span>
                  ),
                },
                { header: "Doğum tarixi", cell: (r) => d(r.birthDate), className: "tabular-nums" },
                { header: "Qeydiyyat", cell: (r) => d(r.registrationDate), className: "tabular-nums" },
                { header: "İş yeri / vəzifə", cell: (r) => [r.workplace, r.position].filter(Boolean).join(" · ") || "—" },
              ]}
            />
          </Section>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Hərbi uçot" icon={ShieldIcon}>
              {p.militaryRecord ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Field label="Mükəlləfiyyət" value={p.militaryRecord.obligation} />
                  <Field label="Rütbə" value={p.militaryRecord.rank} />
                  <Field label="Tərkib" value={p.militaryRecord.profile} />
                  <Field label="Ehtiyat kateqoriyası" value={p.militaryRecord.reserveCategory} />
                  <Field label="HUİ (VUS)" value={p.militaryRecord.specialtyVus} mono />
                  <Field label="Yararlılıq" value={p.militaryRecord.fitness} />
                  <Field label="Hərbi komissarlıq" value={p.militaryRecord.draftBoard} />
                  <Field label="Uçot vəziyyəti" value={p.militaryRecord.status} />
                </dl>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">Məlumat yoxdur</p>
              )}
            </Section>
            <Section title="Əlillik məlumatları">
              <SimpleTable
                rows={p.disabilities}
                columns={[
                  { header: "Qrup", cell: (r) => <Badge variant="warning">{DISABILITY_LABEL[r.group]}</Badge> },
                  { header: "Arayış", cell: (r) => [r.certSeries, r.certNumber].filter(Boolean).join(" "), className: "font-mono text-xs" },
                  { header: "Verilib", cell: (r) => d(r.issueDate), className: "tabular-nums" },
                  { header: "Qüvvədədir", cell: (r) => `${d(r.validFrom)} – ${r.validTo ? d(r.validTo) : "müddətsiz"}`, className: "tabular-nums whitespace-nowrap" },
                ]}
              />
            </Section>
          </div>
        </TabsContent>

        {/* MƏZUNİYYƏT */}
        <TabsContent value="leave" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Cari iş ili üzrə hüquq" value={leave ? `${leave.total} gün` : "—"} tone="success" />
            <Stat label="01.04.2025 qalıqları" value={`${carryover.toFixed(1)} gün`} tone="warning" />
            <Stat label="Ümumi əmək stajı" value={formatYmd(seniority.total)} tone="primary" />
            <Stat label="Stajdan çıxılan" value={`${seniority.deductedDays} gün`} tone={seniority.deductedDays ? "danger" : undefined} />
          </div>
          {leave && (
            <Section title="Məzuniyyət hüququnun hesablanması" description={`İş ili: ${d(leave.periodStart)} – ${d(leave.periodEnd)}`} icon={PalmtreeIcon}>
              <div className="flex flex-col gap-2">
                {[
                  { label: leave.basicFromQuota ? "Əsas məzuniyyət (kvota üzrə)" : "Əsas məzuniyyət (vəzifə üzrə)", v: leave.basic },
                  { label: "Staja görə əlavə (5–10 il: 2, 10–15 il: 4, 15+ il: 6)", v: leave.seniority },
                  { label: "İş şəraitinə görə əlavə", v: leave.hazardous },
                  { label: "14 yaşadək uşağı olan qadınlara", v: leave.motherhood },
                ].map((x) => (
                  <div key={x.label} className="flex items-center gap-3">
                    <span className="flex-1 text-sm">{x.label}</span>
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-success" style={{ width: `${(x.v / Math.max(1, leave.total)) * 100}%` }} />
                    </div>
                    <span className="w-14 text-right text-sm font-medium tabular-nums">{x.v} gün</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t pt-3 font-semibold">
                  <span>Cəmi</span>
                  <span className="tabular-nums">{leave.total} gün</span>
                </div>
              </div>
            </Section>
          )}
          <Section title="Staj tərkibi">
            <Fields>
              <Field label="İşə qəbula qədər" value={formatYmd(seniority.initial)} />
              <Field label="Müəssisədə" value={formatYmd(seniority.service)} />
              <Field label="Elmi staj (ilkin)" value={`${p.scientificSeniorityYears} il ${p.scientificSeniorityMonths} ay ${p.scientificSeniorityDays} gün`} />
              <Field label="Elmi-pedaqoji staj (ilkin)" value={`${p.scientificPedagogicalSeniorityYears} il ${p.scientificPedagogicalSeniorityMonths} ay ${p.scientificPedagogicalSeniorityDays} gün`} />
              <Field label="ASOİU stajı (ilkin)" value={`${p.unecSeniorityYears} il ${p.unecSeniorityMonths} ay ${p.unecSeniorityDays} gün`} />
              <Field label="Sığorta stajı (ilkin)" value={`${p.insuranceSeniorityYears} il ${p.insuranceSeniorityMonths} ay ${p.insuranceSeniorityDays} gün`} />
            </Fields>
          </Section>
          <Section title="Keçmiş iş illəri üzrə qalıqlar" description="01.04.2025 tarixinə tam iş illəri">
            <SimpleTable
              rows={p.leaveBalances}
              columns={[
                { header: "İş ili", cell: (r) => `${d(r.periodStart)} – ${d(r.periodEnd)}`, className: "tabular-nums whitespace-nowrap" },
                { header: "Əsas", cell: (r) => n(r.basicDays), className: "tabular-nums text-right" },
                { header: "Staja görə", cell: (r) => n(r.seniorityDays), className: "tabular-nums text-right" },
                { header: "İş şəraitinə görə", cell: (r) => n(r.hazardousDays), className: "tabular-nums text-right" },
                { header: "Uşaqlı qadınlara", cell: (r) => n(r.motherhoodDays), className: "tabular-nums text-right" },
                {
                  header: "Cəmi",
                  cell: (r) => <span className="font-medium">{n(r.basicDays) + n(r.seniorityDays) + n(r.hazardousDays) + n(r.motherhoodDays)}</span>,
                  className: "tabular-nums text-right",
                },
              ]}
            />
          </Section>
        </TabsContent>

        {/* DAVAMİYYƏT */}
        <TabsContent value="attendance">
          <Section title="İşdə iştirak etməmə" icon={CalendarClockIcon}>
            <SimpleTable
              rows={p.absences}
              columns={[
                {
                  header: "Növ",
                  cell: (r) => <Badge variant={ABSENCE_LABEL[r.type].variant}>{ABSENCE_LABEL[r.type].label}</Badge>,
                },
                { header: "Dövr", cell: (r) => `${d(r.startDate)} – ${d(r.endDate)}`, className: "tabular-nums whitespace-nowrap" },
                { header: "Gün", cell: (r) => daysBetween(r.startDate, r.endDate), className: "tabular-nums text-right" },
              ]}
              empty="İştirak etməmə qeydə alınmayıb"
            />
          </Section>
        </TabsContent>

        {/* ŞƏXSİ İŞ — sənədlər */}
        <TabsContent value="documents">
          <PersonDocuments
            personId={p.id}
            canEdit={canEdit && !p.deletedAt}
            canDelete={canDelete}
            documents={p.documents.map((d) => ({
              id: d.id,
              kind: d.kind,
              title: d.title,
              number: d.number,
              documentDate: d.documentDate?.toISOString() ?? null,
              fileName: d.fileName,
              extension: d.extension,
              size: d.size,
              uploadedBy: d.uploadedBy?.fullName ?? null,
              createdAt: d.createdAt.toISOString(),
              pendingDeletion: d.deletionRequests[0] ? { by: d.deletionRequests[0].requestedBy?.fullName ?? null, reason: d.deletionRequests[0].reason } : null,
            }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PayrollList({ title, lines, total, totalLabel, negative }: { title: string; lines: { label: string; amount: number }[]; total: number; totalLabel: string; negative?: boolean }) {
  return (
    <div>
      {title && <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>}
      <div className="flex flex-col gap-1.5 text-sm">
        {lines
          .filter((l) => l.amount !== 0)
          .map((l) => (
            <div key={l.label} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{l.label}</span>
              <span className={cn("tabular-nums", negative && "text-danger")}>
                {negative ? "−" : ""}
                {formatAzn(l.amount)}
              </span>
            </div>
          ))}
        <div className="mt-1 flex justify-between border-t pt-2 font-medium">
          <span>{totalLabel}</span>
          <span className="tabular-nums">{formatAzn(total)}</span>
        </div>
      </div>
    </div>
  );
}
