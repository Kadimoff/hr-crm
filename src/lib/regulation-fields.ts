/*
 * Əsasnamə (charter) və vəzifə təlimatı (jd) üçün sahə tərifləri — server və brauzer (forma, çap) üçün ortaq.
 */

export type RegulationKind = "charter" | "jd";

export interface RegulationTextField {
  key: string;
  label: string;
  /** Çox sətirli mətn (funksiyalar, vəzifələr) */
  long?: boolean;
  hint?: string;
}

export const REGULATION_TEXT_FIELDS: Record<RegulationKind, RegulationTextField[]> = {
  charter: [
    { key: "purpose", label: "Məqsəd", long: true },
    { key: "functions", label: "Funksiyalar", long: true, hint: "Hər funksiya ayrıca sətirdə" },
    { key: "authorities", label: "Səlahiyyətlər", long: true },
    { key: "responsibilities", label: "Məsuliyyət", long: true },
    { key: "reportingLine", label: "Hesabat xətti", hint: "Kimə tabedir / kimə hesabat verir" },
  ],
  jd: [
    { key: "purpose", label: "Vəzifənin məqsədi", long: true },
    { key: "duties", label: "Vəzifə öhdəlikləri (funksiyalar)", long: true, hint: "Hər öhdəlik ayrıca sətirdə" },
    { key: "rights", label: "Hüquqlar", long: true },
    { key: "responsibilities", label: "Məsuliyyət", long: true },
    { key: "reportsTo", label: "Tabelik (kimə tabedir)" },
    { key: "competencies", label: "Kompetensiyalar", long: true },
    { key: "educationReq", label: "Təhsil tələbi" },
    { key: "experienceReq", label: "Təcrübə tələbi" },
  ],
};

export const REGULATION_TITLES: Record<RegulationKind, { one: string; many: string; registry: string }> = {
  charter: { one: "Əsasnamə", many: "Əsasnamələr", registry: "/structure?tab=charters" },
  jd: { one: "Vəzifə təlimatı", many: "Vəzifə təlimatları", registry: "/positions" },
};

export const regulationHref = (kind: RegulationKind, id: string) => (kind === "charter" ? `/structure/charters/${id}` : `/positions/job-descriptions/${id}`);
export const regulationPrintHref = (kind: RegulationKind, id: string) => `/regulations/${kind}/${id}/print`;
