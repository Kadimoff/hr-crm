/**
 * Əməkhaqqı təxmini hesablayıcısı — dövlət sektoru (ASOİU dövlət müəssisəsidir).
 *
 * Bütün dərəcələr `PayrollConfig`-də saxlanılır ki, qanunvericilik dəyişəndə kodu dəyişmədən yenilənə bilsin.
 * Defolt dəyərlər Vergi Məcəlləsinin 101 və 102-ci maddələrinə, "Sosial sığorta haqqında",
 * "İşsizlikdən sığorta haqqında" və "Tibbi sığorta haqqında" qanunlara əsaslanır; əlavələrin (elmi dərəcə / ad)
 * məbləğləri müəssisənin daxili qaydalarından asılıdır və mühasibatlıq tərəfindən təsdiqlənməlidir.
 */

export interface PayrollConfig {
  incomeTax: {
    /** Bu məbləğədək olan gəlirə aylıq vergidən azad məbləğ tətbiq olunur */
    exemptThreshold: number; // 2500
    exemptAmount: number; // 200
    lowerRate: number; // 0.14
    upperBracketFixed: number; // 350
    upperRate: number; // 0.25
  };
  /** VM 102.2 — aylıq vergi tutulan gəlirdən çıxılan güzəşt məbləğləri, bəndə görə */
  taxExemptions: Record<string, number>;
  dsmf: { employeeRate: number; employerRate: number };
  unemployment: { employeeRate: number; employerRate: number };
  medical: { threshold: number; lowerRate: number; upperRate: number };
  allowances: {
    degree: Record<"PHD" | "DSC", number>;
    title: Record<"DOCENT" | "PROFESSOR" | "CORRESPONDING_MEMBER" | "ACADEMICIAN", number>;
  };
}

export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  incomeTax: { exemptThreshold: 2500, exemptAmount: 200, lowerRate: 0.14, upperBracketFixed: 350, upperRate: 0.25 },
  taxExemptions: { "102.2.1": 400, "102.2.2": 200, "102.2.3": 100, "102.2.4": 50 },
  dsmf: { employeeRate: 0.03, employerRate: 0.22 },
  unemployment: { employeeRate: 0.005, employerRate: 0.005 },
  medical: { threshold: 8000, lowerRate: 0.02, upperRate: 0.005 },
  allowances: {
    degree: { PHD: 100, DSC: 200 },
    title: { DOCENT: 100, PROFESSOR: 200, CORRESPONDING_MEMBER: 300, ACADEMICIAN: 400 },
  },
};

export interface PayrollInput {
  baseSalary: number;
  degrees: ("PHD" | "DSC")[];
  titles: ("DOCENT" | "PROFESSOR" | "CORRESPONDING_MEMBER" | "ACADEMICIAN")[];
  hazardousAllowancePct: number | null;
  taxExemptionClause: string | null;
}

export interface PayrollLine {
  label: string;
  amount: number;
}

export interface PayrollResult {
  earnings: PayrollLine[];
  gross: number;
  deductions: PayrollLine[];
  totalDeductions: number;
  net: number;
  employerContributions: PayrollLine[];
  employerCost: number;
  taxableIncome: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Gəlir vergisi: ≤2500 → (gəlir − 200) × 14%; >2500 → 350 + (gəlir − 2500) × 25% */
export function incomeTax(gross: number, exemption: number, cfg: PayrollConfig["incomeTax"]): { tax: number; taxable: number } {
  const taxable = Math.max(0, gross - exemption);
  if (taxable <= cfg.exemptThreshold) {
    return { tax: round2(Math.max(0, taxable - cfg.exemptAmount) * cfg.lowerRate), taxable };
  }
  return { tax: round2(cfg.upperBracketFixed + (taxable - cfg.exemptThreshold) * cfg.upperRate), taxable };
}

export function medicalInsurance(gross: number, rate: { threshold: number; lowerRate: number; upperRate: number }): number {
  if (gross <= rate.threshold) return round2(gross * rate.lowerRate);
  return round2(rate.threshold * rate.lowerRate + (gross - rate.threshold) * rate.upperRate);
}

export function computePayroll(input: PayrollInput, cfg: PayrollConfig = DEFAULT_PAYROLL_CONFIG): PayrollResult {
  // Bir neçə dərəcə/ad olduqda ən yüksəyi tətbiq olunur
  const degreeAllowance = Math.max(0, ...input.degrees.map((d) => cfg.allowances.degree[d]));
  const titleAllowance = Math.max(0, ...input.titles.map((t) => cfg.allowances.title[t]));
  const hazardousAllowance = round2(input.baseSalary * ((input.hazardousAllowancePct ?? 0) / 100));

  const earnings: PayrollLine[] = [
    { label: "Vəzifə maaşı (oklad)", amount: round2(input.baseSalary) },
    { label: "Elmi dərəcəyə görə əlavə", amount: degreeAllowance },
    { label: "Elmi ada görə əlavə", amount: titleAllowance },
    { label: "Zərərli iş şəraitinə görə əlavə", amount: hazardousAllowance },
  ];
  const gross = round2(earnings.reduce((s, l) => s + l.amount, 0));

  const exemption = input.taxExemptionClause ? (cfg.taxExemptions[input.taxExemptionClause] ?? 0) : 0;
  const { tax, taxable } = incomeTax(gross, exemption, cfg.incomeTax);
  const dsmf = round2(gross * cfg.dsmf.employeeRate);
  const unemployment = round2(gross * cfg.unemployment.employeeRate);
  const medical = medicalInsurance(gross, cfg.medical);

  const deductions: PayrollLine[] = [
    { label: exemption ? `Gəlir vergisi (güzəşt ${exemption} AZN, VM ${input.taxExemptionClause})` : "Gəlir vergisi", amount: tax },
    { label: `DSMF (${cfg.dsmf.employeeRate * 100}%)`, amount: dsmf },
    { label: `İşsizlikdən sığorta (${cfg.unemployment.employeeRate * 100}%)`, amount: unemployment },
    { label: `İcbari tibbi sığorta (${cfg.medical.lowerRate * 100}%)`, amount: medical },
  ];
  const totalDeductions = round2(deductions.reduce((s, l) => s + l.amount, 0));

  const employerContributions: PayrollLine[] = [
    { label: `DSMF — işəgötürən (${cfg.dsmf.employerRate * 100}%)`, amount: round2(gross * cfg.dsmf.employerRate) },
    { label: `İşsizlikdən sığorta — işəgötürən (${cfg.unemployment.employerRate * 100}%)`, amount: round2(gross * cfg.unemployment.employerRate) },
    { label: "İcbari tibbi sığorta — işəgötürən", amount: medicalInsurance(gross, cfg.medical) },
  ];
  const employerCost = round2(gross + employerContributions.reduce((s, l) => s + l.amount, 0));

  return {
    earnings,
    gross,
    deductions,
    totalDeductions,
    net: round2(gross - totalDeductions),
    employerContributions,
    employerCost,
    taxableIncome: taxable,
  };
}
