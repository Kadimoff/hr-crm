import type { PrismaClient } from "@prisma/client";
import { formatAzDate } from "../validation/primitives";
import { normalizeKey } from "../validation/primitives";
import { isDepartmentSheet, type SheetRow } from "../validation/templates";
import type { RefContext, SheetKey } from "../validation/types";

export const employmentNaturalKey = (personCode: string, positionCode: string, departmentCode: string, hireDate: Date) =>
  `${personCode}|${positionCode}|${departmentCode}|${formatAzDate(hireDate)}`;

/** DB-dəki mövcud qeydlərdən istinad kontekstini qurur */
export async function loadContext(db: PrismaClient): Promise<RefContext & { dbEmploymentShares: Map<string, { key: string; share: number }> }> {
  const [departments, positions, persons, employments, staffing] = await Promise.all([
    db.department.findMany({ select: { code: true, level: true, createdOn: true, closedOn: true } }),
    db.position.findMany({ select: { code: true, name: true, validFrom: true, validTo: true, basicLeaveDays: true } }),
    db.person.findMany({ select: { code: true, birthDate: true, gender: true, fin: true, ssn: true } }),
    db.employment.findMany({
      select: {
        hireDate: true,
        status: true,
        unitShare: true,
        person: { select: { code: true } },
        position: { select: { code: true } },
        department: { select: { code: true } },
      },
    }),
    db.staffingUnit.findMany({
      select: {
        periodDate: true,
        unitCount: true,
        minSalary: true,
        maxSalary: true,
        department: { select: { code: true } },
        position: { select: { code: true } },
      },
      orderBy: { periodDate: "asc" },
    }),
  ]);

  const ctx: RefContext & { dbEmploymentShares: Map<string, { key: string; share: number }> } = {
    departments: new Map(departments.map((d) => [d.code, { level: d.level, createdOn: d.createdOn, closedOn: d.closedOn }])),
    positions: new Map(positions.map((p) => [p.code, { validFrom: p.validFrom, validTo: p.validTo, basicLeaveDays: p.basicLeaveDays }])),
    positionNames: new Map(positions.map((p) => [normalizeKey(p.name), p.code])),
    persons: new Map(persons.map((p) => [p.code, { birthDate: p.birthDate, gender: p.gender, fin: p.fin, ssn: p.ssn }])),
    finOwners: new Map(persons.map((p) => [p.fin, p.code])),
    ssnOwners: new Map(persons.filter((p) => p.ssn).map((p) => [p.ssn!, p.code])),
    employments: new Map(),
    staffing: new Map(),
    invalidKeys: new Map(),
    seen: new Map(),
    staffingUsage: new Map(),
    dbEmploymentShares: new Map(),
  };

  for (const e of employments) {
    const list = ctx.employments.get(e.person.code) ?? [];
    const active = e.status !== "TERMINATED";
    list.push({ positionCode: e.position.code, departmentCode: e.department.code, hireDate: e.hireDate, active, unitShare: Number(e.unitShare) });
    ctx.employments.set(e.person.code, list);
    if (active) {
      ctx.dbEmploymentShares.set(employmentNaturalKey(e.person.code, e.position.code, e.department.code, e.hireDate), {
        key: `${e.department.code}|${e.position.code}`,
        share: Number(e.unitShare),
      });
    }
  }
  // asc sıralama → son dövr qalır
  for (const s of staffing) {
    ctx.staffing.set(`${s.department.code}|${s.position.code}`, {
      unitCount: Number(s.unitCount),
      minSalary: Number(s.minSalary),
      maxSalary: Number(s.maxSalary),
      periodDate: s.periodDate,
    });
  }
  return ctx;
}

/** Etibarlı sətri kontekstə əlavə edir ki, sonrakı sətirlər / mərhələlər ona istinad edə bilsin */
export function registerValid(ctx: RefContext, sheet: SheetKey, row: unknown): void {
  if (isDepartmentSheet(sheet)) {
    const r = row as SheetRow<"departments1">;
    ctx.departments.set(r.code, { level: r.level, createdOn: r.createdOn, closedOn: r.closedOn ?? null });
    ctx.invalidKeys.delete(`departments:${r.code}`);
    return;
  }
  switch (sheet) {
    case "positions": {
      const r = row as SheetRow<"positions">;
      ctx.positions.set(r.code, { validFrom: r.validFrom, validTo: r.validTo ?? null, basicLeaveDays: r.basicLeaveDays });
      ctx.positionNames.set(normalizeKey(r.name), r.code);
      ctx.invalidKeys.delete(`positions:${r.code}`);
      break;
    }
    case "staffing": {
      const r = row as SheetRow<"staffing">;
      const key = `${r.departmentCode}|${r.positionCode}`;
      const prev = ctx.staffing.get(key);
      if (!prev || prev.periodDate <= r.periodDate) {
        ctx.staffing.set(key, { unitCount: r.unitCount, minSalary: r.minSalary, maxSalary: r.maxSalary, periodDate: r.periodDate });
      }
      break;
    }
    case "persons": {
      const r = row as SheetRow<"persons">;
      ctx.persons.set(r.code, { birthDate: r.birthDate, gender: r.gender, fin: r.fin, ssn: r.ssn ?? null });
      ctx.invalidKeys.delete(`persons:${r.code}`);
      break;
    }
    case "employments": {
      const r = row as SheetRow<"employments">;
      const list = (ctx.employments.get(r.personCode) ?? []).filter(
        (e) => !(e.positionCode === r.positionCode && e.departmentCode === r.departmentCode && e.hireDate.getTime() === r.hireDate.getTime()),
      );
      list.push({ positionCode: r.positionCode, departmentCode: r.departmentCode, hireDate: r.hireDate, active: true, unitShare: r.unitShare ?? 1 });
      ctx.employments.set(r.personCode, list);
      break;
    }
    default:
      break;
  }
}

/** Xətalı sətrin açarını qeyd edir — asılı sətirlərdə daha dəqiq xəta mesajı üçün */
export function registerInvalid(ctx: RefContext, sheet: SheetKey, raw: Record<string, string>, rowNumber: number): void {
  const group = isDepartmentSheet(sheet) ? "departments" : sheet === "positions" || sheet === "persons" ? sheet : null;
  const code = group ? raw.code?.trim() : undefined;
  if (group && code && !ctx.invalidKeys.has(`${group}:${code}`)) ctx.invalidKeys.set(`${group}:${code}`, rowNumber);
}
