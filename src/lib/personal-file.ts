import type { DocumentKind } from "@prisma/client";
import { DOCUMENT_KINDS } from "./document-types";

/*
 * Elektron şəxsi işin vahid xronoloji indeksi (TZ M05-01): şəxsiyyət, təhsil, elmi dərəcə və ad, staj (əvvəlki iş),
 * müqavilələr, əmrlər (hərəkətlər), təyinatlar, məzuniyyətlər, status sənədləri, tanışlıq qeydləri və sənədlər —
 * bir siyahıda, tarixə görə. Təmiz funksiya (dosye, çap, ZIP və testlər üçün). Maaş məlumatı indeksə daxil edilmir.
 */

export type IndexSection = "identity" | "education" | "academic" | "work" | "contract" | "order" | "leave" | "status" | "ack" | "document";

export const INDEX_SECTION_LABELS: Record<IndexSection, string> = {
  identity: "Şəxsiyyət",
  education: "Təhsil",
  academic: "Elmi dərəcə və ad",
  work: "Əvvəlki iş (staj)",
  contract: "Müqavilə / təyinat",
  order: "Əmr / kadr hərəkəti",
  leave: "Məzuniyyət",
  status: "Status sənədi",
  ack: "Tanışlıq",
  document: "Sənəd",
};

export interface IndexEntry {
  key: string;
  date: Date | null;
  section: IndexSection;
  title: string;
  detail: string;
  /** Sənəd varsa — id (açmaq üçün) və yoxlanılma */
  documentId?: string;
  verified?: boolean;
}

type D = Date | null | undefined;

export interface IndexSource {
  birthDate: Date;
  fullName: string;
  idDocType: string | null;
  idDocNumber: string | null;
  idDocIssueDate: D;
  educations: { id: string; educationType: string; institution: string; specialty?: string | null; startDate?: D; graduationDate?: D }[];
  academicDegrees: { id: string; degreeName: string; awardDate: Date }[];
  academicTitles: { id: string; titleName: string; awardDate: Date }[];
  workHistory: { id: string; organization: string; position: string; startDate: Date; endDate: D }[];
  employments: {
    id: string;
    hireDate: D;
    terminationDate: D;
    terminationArticle: string | null;
    isPrimary: boolean;
    contractType?: string | null;
    contractEndDate?: D;
    position: { name: string };
    department: { name: string };
    movements: { id: string; effectiveDate: Date; orderNumber: string; orderDate: Date; kind: string | null; toDepartment: string | null; toPosition: string | null }[];
    jobDescriptionAcks?: { id: string; assignedAt: Date; acknowledgedAt: D; reason: string | null; jobDescription: { title: string; version: number } }[];
  }[];
  absences: { id: string; type: string; startDate: Date; endDate: Date; orderNumber: string | null; cancelledAt: D }[];
  disabilities: { id: string; group: string; issueDate: D; validFrom: D }[];
  attestations: { id: string; date: Date; result: string }[];
  documents: { id: string; kind: DocumentKind; title: string; number: string | null; documentDate: D; createdAt: Date; verifiedAt: D }[];
}

const ABSENCE: Record<string, string> = {
  SICK: "Xəstəlik",
  UNKNOWN: "Naməlum səbəbdən işdə olmama",
  SOCIAL_PAID: "Sosial məzuniyyət (ödənişli)",
  SOCIAL_UNPAID: "Ödənişsiz sosial məzuniyyət",
  UNPAID: "Ödənişsiz məzuniyyət",
};

const MOVE: Record<string, string> = { TRANSFER: "Köçürmə", PROMOTION: "Vəzifə artımı", SALARY_CHANGE: "Maaş dəyişikliyi", UNIT_CHANGE: "Ştat payı dəyişikliyi" };

const fmt = (d: D) => (d ? `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}` : "");

export function buildPersonalIndex(p: IndexSource): IndexEntry[] {
  const out: IndexEntry[] = [];
  out.push({ key: "birth", date: p.birthDate, section: "identity", title: "Doğum", detail: p.fullName });
  out.push({
    key: "iddoc",
    date: p.idDocIssueDate ?? null,
    section: "identity",
    title: p.idDocType ?? "Şəxsiyyət vəsiqəsi",
    detail: p.idDocNumber ? `№ ${p.idDocNumber}` : "məlum deyil",
  });
  for (const e of p.educations)
    out.push({ key: `edu:${e.id}`, date: e.graduationDate ?? e.startDate ?? null, section: "education", title: e.educationType, detail: [e.institution, e.specialty].filter(Boolean).join(" · ") });
  for (const d of p.academicDegrees) out.push({ key: `deg:${d.id}`, date: d.awardDate, section: "academic", title: d.degreeName, detail: "Elmi dərəcə" });
  for (const t of p.academicTitles) out.push({ key: `tit:${t.id}`, date: t.awardDate, section: "academic", title: t.titleName, detail: "Elmi ad" });
  for (const w of p.workHistory) out.push({ key: `wh:${w.id}`, date: w.startDate, section: "work", title: w.organization, detail: `${w.position} · ${fmt(w.startDate)} – ${fmt(w.endDate) || "…"}` });
  for (const e of p.employments) {
    const label = `${e.position.name} · ${e.department.name}${e.isPrimary ? "" : " (əvəzçilik)"}`;
    const contract = e.contractType === "MUDDETLI" ? `, müddətli${e.contractEndDate ? ` (${fmt(e.contractEndDate)}-dək)` : ""}` : e.contractType === "MUDDETSIZ" ? ", müddətsiz" : "";
    out.push({ key: `hire:${e.id}`, date: e.hireDate ?? null, section: "contract", title: e.hireDate ? "İşə qəbul" : "Təyinat (qəbul tarixi məlum deyil)", detail: `${label}${contract}` });
    if (e.terminationDate) out.push({ key: `term:${e.id}`, date: e.terminationDate, section: "contract", title: "Xitam", detail: `${label}${e.terminationArticle ? ` · ƏM ${e.terminationArticle}` : ""}` });
    for (const m of e.movements)
      out.push({
        key: `mv:${m.id}`,
        date: m.effectiveDate,
        section: "order",
        title: (m.kind && MOVE[m.kind]) || "Kadr hərəkəti",
        detail: `Əmr № ${m.orderNumber} (${fmt(m.orderDate)})${m.toPosition || m.toDepartment ? ` → ${[m.toPosition, m.toDepartment].filter(Boolean).join(" · ")}` : ""}`,
      });
    for (const a of e.jobDescriptionAcks ?? [])
      out.push({
        key: `ack:${a.id}`,
        date: a.acknowledgedAt ?? a.assignedAt,
        section: "ack",
        title: a.acknowledgedAt ? "Vəzifə təlimatı ilə tanış olub" : "Vəzifə təlimatı ilə tanışlıq gözlənilir",
        detail: `${a.jobDescription.title} · v${a.jobDescription.version}${a.reason ? ` · ${a.reason}` : ""}`,
      });
  }
  for (const a of p.absences)
    out.push({
      key: `ab:${a.id}`,
      date: a.startDate,
      section: "leave",
      title: `${ABSENCE[a.type] ?? a.type}${a.cancelledAt ? " (ləğv edilib)" : ""}`,
      detail: `${fmt(a.startDate)} – ${fmt(a.endDate)}${a.orderNumber ? ` · əmr № ${a.orderNumber}` : ""}`,
    });
  for (const d of p.disabilities) out.push({ key: `dis:${d.id}`, date: d.issueDate ?? d.validFrom ?? null, section: "status", title: "Əlillik arayışı", detail: d.group });
  for (const a of p.attestations) out.push({ key: `att:${a.id}`, date: a.date, section: "status", title: "Attestasiya", detail: a.result });
  for (const d of p.documents)
    out.push({
      key: `doc:${d.id}`,
      date: d.documentDate ?? d.createdAt,
      section: "document",
      title: d.title,
      detail: `${DOCUMENT_KINDS[d.kind]}${d.number ? ` · № ${d.number}` : ""}`,
      documentId: d.id,
      verified: !!d.verifiedAt,
    });
  // Ən yeni yuxarıda; tarixi məlum olmayanlar sonda
  return out.sort((a, b) => (b.date?.getTime() ?? Number.NEGATIVE_INFINITY) - (a.date?.getTime() ?? Number.NEGATIVE_INFINITY) || a.key.localeCompare(b.key));
}
