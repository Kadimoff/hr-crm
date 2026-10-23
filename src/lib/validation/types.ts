import type { ImportStage } from "@prisma/client";
import type { z } from "zod";

export type ValidationTier = "syntactic" | "semantic" | "reference";
export type Severity = "error" | "warning";

export interface FieldIssue {
  field: string; // sütun açarı; "*" = bütün sətir
  tier: ValidationTier;
  severity: Severity;
  message: string;
  /** Avtomatik düzəliş təklifi (məs. hesablanmış qeydiyyat tarixi) */
  suggestion?: string;
}

export type RawRow = Record<string, string>;

export type TemplateKey =
  | "kadr"
  | "family"
  | "leave"
  | "staffing"
  | "departments"
  | "other"
  | "research"
  | "personal"
  | "absences"
  | "terminations";

export type SheetKey =
  // 5 Struktur bölmələri — səviyyə vərəqdən gəlir
  | "departments1"
  | "departments2"
  | "departments3"
  | "departments4"
  // 1 Kadr Cədvəlləri
  | "positions"
  | "persons"
  | "employments"
  | "workHistory"
  | "military"
  | "disabilities"
  // 4 Ştat cədvəli
  | "staffing"
  // 2 Ailə məlumatları
  | "family"
  // 6 Digər məlumatlar
  | "patents"
  | "projects"
  | "events"
  | "publications"
  | "attestations"
  // 7 Elmi tədqiqatlar
  | "research"
  // 8 Fiziki şəxsə aid məlumatlar
  | "languages"
  | "educations"
  | "skills"
  | "degrees"
  | "titles"
  | "honoraryTitles"
  | "stateAwards"
  | "prizes"
  | "software"
  | "parties"
  | "electedOrgans"
  | "liabilities"
  // 3 Məzuniyyət qalıqları — 4 növ
  | "leaveBasic"
  | "leaveSeniority"
  | "leaveHazardous"
  | "leaveMotherhood"
  // 9 İşdə iştirak etməmə — 3 vərəq
  | "absencesSick"
  | "absencesSocial"
  | "absencesUnpaid"
  // 10 İşdən azad olunmuşlar
  | "terminations";

export interface ColumnDef {
  key: string;
  header: string;
  /** İki sətirli başlıqda üst (birləşdirilmiş) xana, məs. "Əmək stajı" → "İllər" */
  group?: string;
  /** Üst xananın alternativ yazılışları (məs. köhnə şablonlardakı ad) */
  groupAliases?: string[];
  /** Başlığın alternativ yazılışları */
  aliases?: string[];
  required?: boolean;
  width?: number;
}

/** İstinad yoxlaması üçün kontekst — DB + əvvəlki mərhələlərin VALID sətirləri */
export interface RefContext {
  departments: Map<string, { level: number; createdOn: Date; closedOn: Date | null }>;
  positions: Map<string, { validFrom: Date; validTo: Date | null; basicLeaveDays: number }>;
  /** normallaşdırılmış vəzifə adı → vəzifə kodu (adlar təkrarlana bilməz) */
  positionNames: Map<string, string>;
  persons: Map<string, { birthDate: Date; gender: "MALE" | "FEMALE"; fin: string; ssn: string | null }>;
  /** FİN → şəxs kodu, SSN → şəxs kodu (DB-dəki mövcud qeydlər) */
  finOwners: Map<string, string>;
  ssnOwners: Map<string, string>;
  /** personCode → müqavilələr */
  employments: Map<string, { positionCode: string; departmentCode: string; hireDate: Date; active: boolean; unitShare: number }[]>;
  /** `${dept}|${pos}` → ən son dövrün ştat vahidi və maaş diapazonu */
  staffing: Map<string, { unitCount: number; minSalary: number; maxSalary: number; periodDate: Date }>;
  /** Eyni batch-da mövcud, lakin xətalı olan açarlar: `${sheet}:${code}` → sətir nömrəsi */
  invalidKeys: Map<string, number>;
  /** Sənəddaxili təkrarlanma yoxlaması üçün yığım */
  seen: Map<string, number>;
  /** Ştat limiti üçün yığılan istifadə */
  staffingUsage: Map<string, number>;
}

export interface SheetDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  key: SheetKey;
  templateKey: TemplateKey;
  /** Excel vərəqinin adı (və alternativləri); null = yeganə vərəq */
  sheetNames: string[] | null;
  stage: ImportStage;
  title: string;
  columns: ColumnDef[];
  schema: S;
  /** Sətirlər arası / sahələr arası semantik qaydalar */
  semantic?: (row: z.infer<S>, raw: RawRow) => FieldIssue[];
  /** Xarici açar yoxlamaları */
  references?: (row: z.infer<S>, ctx: RefContext, rowNumber: number) => FieldIssue[];
  /** Mərhələdən sonrakı sətirlərin görə biləcəyi açarlar */
  provides?: (row: z.infer<S>) => string;
  /** Siyahı tipli vərəqlər üçün: şəxs üzrə atomik əvəzetmə */
  personScoped?: boolean;
}

export interface TemplateDef {
  key: TemplateKey;
  number: number;
  fileName: string;
  title: string;
  sheets: SheetKey[];
}
