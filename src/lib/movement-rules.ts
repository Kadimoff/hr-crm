/** Kadr hərəkəti — saf funksiyalar (server, klient və testlər üçün) */

/** EmploymentMovement.kind dəyərləri (Prisma enum MovementKind ilə eyni) */
export const MOVEMENT_KINDS = ["TRANSFER", "PROMOTION", "SALARY_CHANGE", "UNIT_CHANGE"] as const;
export type MovementKindCode = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_KIND_LABELS: Record<MovementKindCode, string> = {
  TRANSFER: "Köçürmə",
  PROMOTION: "Vəzifə artımı",
  SALARY_CHANGE: "Maaş dəyişikliyi",
  UNIT_CHANGE: "Ştat dəyişikliyi",
};

/** «Kadr hərəkəti» hesabatının növ filtri: işə qəbul, hərəkət növləri, ödənişsiz məzuniyyət, azad olunma */
export const REPORT_EVENT_KINDS = ["HIRE", ...MOVEMENT_KINDS, "UNPAID_LEAVE", "TERMINATION"] as const;
export type ReportEventKind = (typeof REPORT_EVENT_KINDS)[number];
export const REPORT_EVENT_LABELS: Record<ReportEventKind, string> = {
  HIRE: "İşə qəbul",
  ...MOVEMENT_KIND_LABELS,
  UNPAID_LEAVE: "Ödənişsiz məzuniyyət",
  TERMINATION: "Azad olunma",
};
export const isReportEventKind = (v: unknown): v is ReportEventKind => typeof v === "string" && (REPORT_EVENT_KINDS as readonly string[]).includes(v);
export const isMovementKind = (v: unknown): v is MovementKindCode => typeof v === "string" && (MOVEMENT_KINDS as readonly string[]).includes(v);

export interface MovementInput {
  personId: string;
  employmentId: string;
  /** Formanın açıldığı andakı Person.updatedAt (ISO) — optimistik kilid */
  expectedUpdatedAt?: string;
  /** Əmrdə göstərilən növ; verilməyibsə dəyişikliyə görə təyin olunur ({@link inferMovementKind}) */
  kind?: MovementKindCode;
  orderNumber: string;
  orderDate: Date;
  effectiveDate: Date;
  departmentId: string;
  positionId: string;
  baseSalary: number;
  unitShare: number;
  note?: string;
}

export interface MovementDiff {
  fromDepartment: string | null;
  toDepartment: string | null;
  fromPosition: string | null;
  toPosition: string | null;
  fromSalary: number | null;
  toSalary: number | null;
  fromUnitShare: number | null;
  toUnitShare: number | null;
}

/** Nə dəyişib — növ qaydaları üçün */
export interface MovementChanges {
  department: boolean;
  position: boolean;
  salary: boolean;
  unitShare: boolean;
}

const money = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/,/g, " ")} ₼`;
const share = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const changesOf = (m: MovementDiff): MovementChanges => ({
  department: m.toDepartment !== null,
  position: m.toPosition !== null,
  salary: m.toSalary !== null,
  unitShare: m.toUnitShare !== null,
});

/**
 * Növü olmayan (köhnə) qeydlər və formada «avtomatik» seçimi üçün: bölmə / vəzifə dəyişibsə — köçürmə,
 * ştat payı dəyişibsə (oklad ilə və ya olmadan) — ştat dəyişikliyi, yalnız oklad — maaş dəyişikliyi.
 */
export function inferMovementKind(c: MovementChanges): MovementKindCode {
  if (c.department || c.position) return "TRANSFER";
  if (c.unitShare) return "UNIT_CHANGE";
  return "SALARY_CHANGE";
}

/** Qeydin növ kodu: əmrdə göstərilən, yoxdursa — təxmini */
export const movementKindOf = (m: MovementDiff, kind?: MovementKindCode | null): MovementKindCode => kind ?? inferMovementKind(changesOf(m));

/**
 * Növ ilə dəyişikliyin uyğunluğu. null — qayda pozulmayıb.
 *  - Vəzifə artımı: yeni vəzifə məcburidir (bölmə və oklad da dəyişə bilər).
 *  - Köçürmə: bölmə və ya vəzifə dəyişməlidir.
 *  - Maaş dəyişikliyi: oklad dəyişməlidir; bölmə / vəzifə dəyişmir (ştat payı dəyişə bilər).
 *  - Ştat dəyişikliyi: ştat payı dəyişməlidir; bölmə / vəzifə dəyişmir (oklad dəyişə bilər).
 */
export function movementKindError(kind: MovementKindCode, c: MovementChanges): { field: string; message: string } | null {
  const job = c.department || c.position;
  switch (kind) {
    case "PROMOTION":
      return c.position ? null : { field: "positionId", message: "Vəzifə artımında yeni vəzifəni seçin (indikindən fərqli)" };
    case "TRANSFER":
      return job ? null : { field: "departmentId", message: "Köçürmədə yeni struktur bölmə və ya vəzifə seçilməlidir" };
    case "SALARY_CHANGE":
      if (job) return { field: "movementKind", message: "Bölmə / vəzifə dəyişir — növü «Köçürmə» və ya «Vəzifə artımı» seçin" };
      return c.salary ? null : { field: "baseSalary", message: "Maaş dəyişikliyində yeni okladı daxil edin" };
    case "UNIT_CHANGE":
      if (job) return { field: "movementKind", message: "Bölmə / vəzifə dəyişir — növü «Köçürmə» və ya «Vəzifə artımı» seçin" };
      return c.unitShare ? null : { field: "unitShare", message: "Ştat dəyişikliyində yeni ştat payını daxil edin" };
  }
}

/**
 * Hərəkətin növ mətni və «əvvəl → sonra» təsviri; null sahələr — dəyişməyib.
 * kind (əmrdəki növ) verilibsə — onun adı; köhnə qeydlərdə növ mətni dəyişikliyə görə qurulur.
 */
export function describeMovement(m: MovementDiff, kind?: MovementKindCode | null): { kind: string; details: string } {
  const c = changesOf(m);
  const transfer = c.department || c.position;
  const legacy = transfer ? (c.salary ? "Köçürmə, oklad dəyişikliyi" : "Köçürmə") : c.salary ? "Oklad dəyişikliyi" : c.unitShare ? "Ştat payı dəyişikliyi" : "Dəyişiklik";
  const parts: string[] = [];
  if (m.toDepartment !== null) parts.push(`${m.fromDepartment ?? "—"} → ${m.toDepartment}`);
  if (m.toPosition !== null) parts.push(`${m.fromPosition ?? "—"} → ${m.toPosition}`);
  if (m.toSalary !== null) parts.push(`oklad ${m.fromSalary === null ? "—" : money(m.fromSalary)} → ${money(m.toSalary)}`);
  if (m.toUnitShare !== null) parts.push(`ştat ${m.fromUnitShare === null ? "—" : share(m.fromUnitShare)} → ${share(m.toUnitShare)}`);
  return { kind: kind ? MOVEMENT_KIND_LABELS[kind] : legacy, details: parts.join("; ") };
}
