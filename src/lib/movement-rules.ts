/** Kadr hərəkəti — saf funksiyalar (server, klient və testlər üçün) */

export interface MovementInput {
  personId: string;
  employmentId: string;
  /** Formanın açıldığı andakı Person.updatedAt (ISO) — optimistik kilid */
  expectedUpdatedAt?: string;
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

const money = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/,/g, " ")} ₼`;
const share = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Hərəkətin növü («Köçürmə», «Oklad dəyişikliyi», …) və «əvvəl → sonra» təsviri; null sahələr — dəyişməyib */
export function describeMovement(m: MovementDiff): { kind: string; details: string } {
  const transfer = m.toDepartment !== null || m.toPosition !== null;
  const salary = m.toSalary !== null;
  const unit = m.toUnitShare !== null;
  const kind = transfer ? (salary ? "Köçürmə, oklad dəyişikliyi" : "Köçürmə") : salary ? "Oklad dəyişikliyi" : unit ? "Ştat payı dəyişikliyi" : "Dəyişiklik";
  const parts: string[] = [];
  if (m.toDepartment !== null) parts.push(`${m.fromDepartment ?? "—"} → ${m.toDepartment}`);
  if (m.toPosition !== null) parts.push(`${m.fromPosition ?? "—"} → ${m.toPosition}`);
  if (m.toSalary !== null) parts.push(`oklad ${m.fromSalary === null ? "—" : money(m.fromSalary)} → ${money(m.toSalary)}`);
  if (m.toUnitShare !== null) parts.push(`ştat ${m.fromUnitShare === null ? "—" : share(m.fromUnitShare)} → ${share(m.toUnitShare)}`);
  return { kind, details: parts.join("; ") };
}
