import "server-only";
import { prisma } from "@/lib/db";
import { personScopeWhere } from "@/lib/auth/scope";
import { COMPLETENESS_KEYS, missingFields, type CompletenessField } from "@/lib/unknown-values";

export interface CompletenessRow {
  personId: string;
  code: string;
  fullName: string;
  department: string | null;
  position: string | null;
  missing: CompletenessField[];
  openingSeniorityYears: number | null;
  openingSenioritySource: string | null;
}

/**
 * «Məlumat tamlığı» (TZ DAT-02 / MIG-04): aktiv müqaviləsi olan əməkdaşlardan məcburi sahəsi çatışmayanlar.
 * scope — şöbə rəhbəri üçün bölmələr; hidden — maaşı gizlədilən şəxslər (onlar üçün «oklad məlum deyil» göstərilmir —
 * maaş haqqında heç bir məlumat sızmasın).
 */
export async function getCompletenessRows(scope: string[] | null, hidden: ReadonlySet<string>): Promise<CompletenessRow[]> {
  const persons = await prisma.person.findMany({
    where: { ...personScopeWhere(scope), employments: { some: { status: { not: "TERMINATED" }, ...(scope ? { departmentId: { in: scope } } : {}) } } },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      code: true,
      fullName: true,
      idDocType: true,
      idDocNumber: true,
      openingSeniorityYears: true,
      openingSeniorityVerifiedAt: true,
      openingSenioritySource: true,
      employments: {
        where: { status: { not: "TERMINATED" } },
        orderBy: [{ isPrimary: "desc" }, { hireDate: { sort: "asc", nulls: "last" } }],
        select: { hireDate: true, baseSalary: true, schedule: true, paymentForm: true, department: { select: { name: true } }, position: { select: { name: true } } },
      },
    },
  });
  const out: CompletenessRow[] = [];
  for (const p of persons) {
    const opening = p.openingSeniorityYears === null ? null : Number(p.openingSeniorityYears);
    let missing = missingFields({
      idDocType: p.idDocType,
      idDocNumber: p.idDocNumber,
      openingSeniorityYears: opening,
      openingSeniorityVerifiedAt: p.openingSeniorityVerifiedAt,
      employments: p.employments,
    });
    if (hidden.has(p.id)) missing = missing.filter((f) => f !== "baseSalary");
    if (missing.length === 0) continue;
    const main = p.employments[0];
    out.push({
      personId: p.id,
      code: p.code,
      fullName: p.fullName,
      department: main?.department.name ?? null,
      position: main?.position.name ?? null,
      missing,
      openingSeniorityYears: opening,
      openingSenioritySource: p.openingSenioritySource,
    });
  }
  return out;
}

/** Sahə üzrə say (filtr düymələri üçün) */
export function countByField(rows: CompletenessRow[]): Record<CompletenessField, number> {
  const c = Object.fromEntries(COMPLETENESS_KEYS.map((k) => [k, 0])) as Record<CompletenessField, number>;
  for (const r of rows) for (const f of r.missing) c[f]++;
  return c;
}
