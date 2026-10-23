import { Prisma, type AbsenceType, type ImportStage, type PrismaClient } from "@prisma/client";
import {
  ABSENCE_SHEETS,
  CHILD_RELATIONS,
  classifyDegree,
  classifyTitle,
  departmentLevel,
  familyRegistrationDate,
  getSheet,
  isDepartmentSheet,
  LEAVE_BALANCE_AS_OF,
  LEAVE_SHEETS,
  normalizeWorkYearEnd,
  type AbsenceSheetKey,
  type LeaveSheetKey,
  type SheetRow,
} from "../validation/templates";
import type { FieldIssue, RawRow, SheetKey } from "../validation/types";
import { emit } from "./progress";
import { STAGE_ORDER } from "./validator";

type Tx = Prisma.TransactionClient;

interface StagedRow {
  id: string;
  sheetKey: SheetKey;
  rowNumber: number;
  data: RawRow;
}

/** Kod → ID axtarış cədvəlləri (hər mərhələdən əvvəl yenilənir) */
interface Lookups {
  departments: Map<string, string>;
  positions: Map<string, string>;
  persons: Map<string, string>;
  /** İdxalı başladan istifadəçi — şəxslərin createdBy/updatedBy sahələri üçün */
  userId: string | null;
}

async function loadLookups(db: PrismaClient, userId: string | null): Promise<Lookups> {
  const [d, p, s] = await Promise.all([
    db.department.findMany({ select: { id: true, code: true } }),
    db.position.findMany({ select: { id: true, code: true } }),
    db.person.findMany({ select: { id: true, code: true } }),
  ]);
  return {
    departments: new Map(d.map((x) => [x.code, x.id])),
    positions: new Map(p.map((x) => [x.code, x.id])),
    persons: new Map(s.map((x) => [x.code, x.id])),
    userId,
  };
}

class CommitError extends Error {}

function need(map: Map<string, string>, code: string, label: string): string {
  const id = map.get(code);
  if (!id) throw new CommitError(`${label} "${code}" bazada tapılmadı`);
  return id;
}

function parse<K extends SheetKey>(key: K, raw: RawRow): SheetRow<K> {
  const r = getSheet(key).schema.safeParse(raw);
  if (!r.success) throw new CommitError("Sətir yenidən oxunarkən xəta: " + r.error.issues[0]?.message);
  return r.data as SheetRow<K>;
}

const isLeaveSheet = (k: SheetKey): k is LeaveSheetKey => k in LEAVE_SHEETS;
const isAbsenceSheet = (k: SheetKey): k is AbsenceSheetKey => k in ABSENCE_SHEETS;

// ----------------------------------------------------------------------------
//  Tək sətirlik (entity) yazılar
// ----------------------------------------------------------------------------

async function writeEntity(tx: Tx, row: StagedRow, lk: Lookups): Promise<void> {
  const sheet = row.sheetKey;

  if (isDepartmentSheet(sheet)) {
    const r = parse(sheet, row.data);
    const parentId = r.parentCode ? need(lk.departments, r.parentCode, "Tabe olduğu bölmə") : null;
    const data = { name: r.name, level: r.level, isFaculty: r.isFaculty, isChair: r.isChair, parentId, createdOn: r.createdOn, closedOn: r.closedOn ?? null };
    const d = await tx.department.upsert({ where: { code: r.code }, create: { code: r.code, ...data }, update: data, select: { id: true } });
    lk.departments.set(r.code, d.id);
    return;
  }

  if (isLeaveSheet(sheet)) {
    // 4 vərəq (əsas, staj, iş şəraiti, qadınlar) eyni iş ili üzrə bir sətirdə birləşir
    const r = parse(sheet, row.data);
    const personId = need(lk.persons, r.personCode, "Əməkdaş");
    const field = LEAVE_SHEETS[sheet].field;
    const periodEnd = normalizeWorkYearEnd(r.periodStart, r.periodEnd);
    if (!periodEnd) throw new CommitError("Natamam iş ili");
    await tx.leaveBalance.upsert({
      where: { personId_periodStart: { personId, periodStart: r.periodStart } },
      create: { personId, periodStart: r.periodStart, periodEnd, asOfDate: LEAVE_BALANCE_AS_OF, [field]: r.days },
      update: { periodEnd, asOfDate: LEAVE_BALANCE_AS_OF, [field]: r.days },
    });
    return;
  }

  switch (sheet) {
    case "positions": {
      const r = parse("positions", row.data);
      const data = {
        name: r.name,
        category: r.category,
        staffCategory: r.staffCategory,
        basicLeaveDays: r.basicLeaveDays,
        hazardousLeaveDays: r.hazardousLeaveDays,
        hazardousAllowancePct: r.hazardousAllowancePct ?? null,
        isPedagogical: r.isPedagogical,
        isScientific: r.isScientific,
        isScientificPedagogical: r.isScientificPedagogical,
        isAdministrativeManagement: r.isAdministrativeManagement,
        validFrom: r.validFrom,
        validTo: r.validTo ?? null,
      };
      const p = await tx.position.upsert({ where: { code: r.code }, create: { code: r.code, ...data }, update: data, select: { id: true } });
      lk.positions.set(r.code, p.id);
      return;
    }
    case "staffing": {
      const r = parse("staffing", row.data);
      const departmentId = need(lk.departments, r.departmentCode, "Bölmə");
      const positionId = need(lk.positions, r.positionCode, "Vəzifə");
      const data = { unitCount: r.unitCount, minSalary: r.minSalary, maxSalary: r.maxSalary, salaryType: r.salaryType ?? null, schedule: r.schedule };
      await tx.staffingUnit.upsert({
        where: { periodDate_departmentId_positionId: { periodDate: r.periodDate, departmentId, positionId } },
        create: { periodDate: r.periodDate, departmentId, positionId, ...data },
        update: data,
      });
      return;
    }
    case "persons": {
      const r = parse("persons", row.data);
      const { code, ...rest } = r;
      const data = {
        ...rest,
        fullName: [r.lastName, r.firstName, r.patronymic].filter(Boolean).join(" "),
        maritalStatus: r.maritalStatus ?? null,
        quotaBasicLeaveDays: r.quotaBasicLeaveDays ?? null,
      };
      const p = await tx.person.upsert({
        where: { code },
        create: { code, ...data, createdById: lk.userId },
        update: { ...data, updatedById: lk.userId },
        select: { id: true },
      });
      lk.persons.set(code, p.id);
      return;
    }
    case "employments": {
      const r = parse("employments", row.data);
      const personId = need(lk.persons, r.personCode, "Əməkdaş");
      const positionId = need(lk.positions, r.positionCode, "Vəzifə");
      const departmentId = need(lk.departments, r.departmentCode, "Bölmə");
      const where = { personId_positionId_departmentId_hireDate: { personId, positionId, departmentId, hireDate: r.hireDate } };
      const existing = await tx.employment.findUnique({ where, select: { id: true, baseSalary: true } });
      const data = { schedule: r.schedule, paymentForm: r.paymentForm, baseSalary: r.baseSalary, unitShare: r.unitShare ?? 1 };
      if (!existing) {
        await tx.employment.create({
          data: { personId, positionId, departmentId, hireDate: r.hireDate, ...data, salaryHistory: { create: { baseSalary: r.baseSalary, validFrom: r.hireDate } } },
        });
        return;
      }
      await tx.employment.update({ where: { id: existing.id }, data });
      if (Number(existing.baseSalary) !== r.baseSalary) {
        const now = new Date();
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        await tx.salaryRecord.updateMany({ where: { employmentId: existing.id, validTo: null }, data: { validTo: new Date(today.getTime() - 86_400_000) } });
        await tx.salaryRecord.create({ data: { employmentId: existing.id, baseSalary: r.baseSalary, validFrom: today } });
      }
      return;
    }
    case "military": {
      const r = parse("military", row.data);
      const personId = need(lk.persons, r.personCode, "Əməkdaş");
      const { personCode: _pc, ...data } = r;
      await tx.militaryRecord.upsert({ where: { personId }, create: { personId, ...data }, update: data });
      return;
    }
    case "terminations": {
      const r = parse("terminations", row.data);
      const personId = need(lk.persons, r.personCode, "Əməkdaş");
      const positionId = need(lk.positions, r.positionCode, "Vəzifə");
      const departmentId = need(lk.departments, r.departmentCode, "Bölmə");
      const candidates = await tx.employment.findMany({ where: { personId, positionId, departmentId, status: { not: "TERMINATED" } }, select: { id: true } });
      if (candidates.length === 0) throw new CommitError("Xitam üçün aktiv əmək müqaviləsi tapılmadı");
      for (const { id } of candidates) {
        await tx.employment.update({ where: { id }, data: { status: "TERMINATED", terminationDate: r.terminationDate, terminationArticle: r.terminationArticle } });
        await tx.salaryRecord.updateMany({ where: { employmentId: id, validTo: null }, data: { validTo: r.terminationDate } });
      }
      return;
    }
    default:
      throw new CommitError(`"${sheet}" vərəqi şəxs üzrə qrup rejimində yazılmalıdır`);
  }
}

// ----------------------------------------------------------------------------
//  Şəxs üzrə atomik əvəzetmə (siyahı tipli vərəqlər)
// ----------------------------------------------------------------------------

async function replacePersonList(tx: Tx, sheet: SheetKey, personId: string, raws: RawRow[], hireDate: Date | null): Promise<void> {
  if (isAbsenceSheet(sheet)) {
    // 3 vərəq eyni cədvələ yazır — hər vərəq yalnız öz növlərini əvəz edir
    const types = Object.values(ABSENCE_SHEETS[sheet].map) as AbsenceType[];
    await tx.absence.deleteMany({ where: { personId, type: { in: types } } });
    const rows = raws.map((x) => parse(sheet, x));
    await tx.absence.createMany({ data: rows.map((r) => ({ personId, type: r.type, startDate: r.startDate, endDate: r.endDate })) });
    return;
  }

  switch (sheet) {
    case "workHistory": {
      await tx.workHistory.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("workHistory", x));
      await tx.workHistory.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "disabilities": {
      await tx.disability.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("disabilities", x));
      await tx.disability.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "family": {
      await tx.familyMember.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("family", x));
      await tx.familyMember.createMany({
        data: rows.map(({ personCode: _p, ...r }) => {
          const isChild = CHILD_RELATIONS.has(r.relation);
          // Boş qeydiyyat tarixi qaydaya görə doldurulur
          const auto = hireDate ? familyRegistrationDate(r.birthDate, hireDate) : r.birthDate;
          return {
            personId,
            fullName: r.fullName,
            relation: r.relation,
            isChild,
            isDisabledChild: r.relation.includes("əlil"),
            birthDate: r.birthDate,
            registrationDate: r.registrationDate ?? auto,
            workplace: r.workplace,
            position: r.position,
          };
        }),
      });
      return;
    }
    case "patents": {
      await tx.intellectualProperty.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("patents", x));
      await tx.intellectualProperty.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "projects": {
      await tx.project.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("projects", x));
      await tx.project.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "events": {
      await tx.scientificEvent.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("events", x));
      await tx.scientificEvent.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "publications": {
      await tx.publication.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("publications", x));
      await tx.publication.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "attestations": {
      await tx.attestation.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("attestations", x));
      await tx.attestation.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "research": {
      await tx.researchTopic.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("research", x));
      await tx.researchTopic.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "languages": {
      await tx.languageProficiency.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("languages", x));
      await tx.languageProficiency.createMany({ data: rows.map((r) => ({ personId, language: r.language, level: r.level })) });
      return;
    }
    case "educations": {
      await tx.education.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("educations", x));
      await tx.education.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "skills":
    case "software": {
      const kind = sheet === "software" ? "SOFTWARE" : "GENERAL";
      await tx.skill.deleteMany({ where: { personId, kind } });
      const rows = raws.map((x) => parse(sheet, x));
      await tx.skill.createMany({ data: rows.map((r) => ({ personId, kind, name: r.name, proficiency: r.proficiency ?? null })), skipDuplicates: true });
      return;
    }
    case "degrees": {
      await tx.academicDegree.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("degrees", x));
      await tx.academicDegree.createMany({
        data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r, degree: classifyDegree(r.degreeName)! })),
      });
      return;
    }
    case "titles": {
      await tx.academicTitle.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("titles", x));
      await tx.academicTitle.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r, title: classifyTitle(r.titleName)! })) });
      return;
    }
    case "honoraryTitles":
    case "stateAwards":
    case "prizes": {
      const kind = sheet === "honoraryTitles" ? "HONORARY_TITLE" : sheet === "stateAwards" ? "STATE_AWARD" : "PRIZE";
      await tx.award.deleteMany({ where: { personId, kind } });
      const rows = raws.map((x) => parse(sheet, x));
      await tx.award.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, kind, ...r })) });
      return;
    }
    case "parties": {
      await tx.partyMembership.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("parties", x));
      await tx.partyMembership.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "electedOrgans": {
      await tx.electedOrgan.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("electedOrgans", x));
      await tx.electedOrgan.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    case "liabilities": {
      await tx.legalLiability.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("liabilities", x));
      await tx.legalLiability.createMany({ data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r })) });
      return;
    }
    default:
      throw new CommitError(`"${sheet}" siyahı tipli vərəq deyil`);
  }
}

// ----------------------------------------------------------------------------
//  Status yeniləmələri
// ----------------------------------------------------------------------------

async function markCommitted(db: PrismaClient, ids: string[]) {
  if (ids.length) await db.stagingRow.updateMany({ where: { id: { in: ids } }, data: { status: "COMMITTED" } });
}

async function markFailed(db: PrismaClient, ids: string[], message: string) {
  const issue: FieldIssue = { field: "*", tier: "reference", severity: "error", message: `Yazılma xətası: ${message}` };
  if (ids.length) await db.stagingRow.updateMany({ where: { id: { in: ids } }, data: { status: "INVALID", errors: [issue] as unknown as Prisma.InputJsonValue } });
}

const errMessage = (e: unknown) =>
  e instanceof CommitError ? e.message : e instanceof Prisma.PrismaClientKnownRequestError ? `${e.code}: ${e.message.split("\n").pop()}` : String(e);

const CHUNK = 100;

/**
 * VALID sətirləri topoloji ardıcıllıqla bazaya yazır.
 * - Entity vərəqləri: 100 sətirlik tranzaksiyalar; tranzaksiya uğursuz olarsa sətir-sətir təkrar edilir və xətalı sətir ayrılır.
 * - Siyahı vərəqləri: şəxs üzrə atomik — şəxsin həmin vərəqdəki bütün sətirləri etibarlıdırsa, köhnə qeydlər əvəz olunur.
 */
export async function commitBatch(db: PrismaClient, batchId: string): Promise<{ committed: number; failed: number }> {
  let committed = 0;
  let failed = 0;
  const { createdBy } = await db.importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { createdBy: true } });

  for (const stage of STAGE_ORDER) {
    const rows = (await db.stagingRow.findMany({
      where: { batchId, stage: stage as ImportStage, status: { in: ["VALID", "INVALID"] } },
      select: { id: true, sheetKey: true, rowNumber: true, data: true, status: true },
      orderBy: [{ sheetKey: "asc" }, { rowNumber: "asc" }],
    })) as (StagedRow & { status: "VALID" | "INVALID" })[];
    if (rows.length === 0) continue;

    const lk = await loadLookups(db, createdBy);
    const total = rows.filter((r) => r.status === "VALID").length;
    let done = 0;

    const bySheet = new Map<SheetKey, typeof rows>();
    for (const r of rows) bySheet.set(r.sheetKey, [...(bySheet.get(r.sheetKey) ?? []), r]);
    // Bölmələr valideyn → övlad ardıcıllığı ilə (1-ci → 4-cü mərhələ)
    const sheetOrder = [...bySheet.keys()].sort((a, b) => departmentLevel(a) - departmentLevel(b));

    for (const sheet of sheetOrder) {
      const sheetRows = bySheet.get(sheet)!;
      const def = getSheet(sheet);

      if (def.personScoped) {
        const groups = new Map<string, typeof rows>();
        for (const r of sheetRows) {
          const pc = (r.data.personCode ?? "").trim();
          groups.set(pc, [...(groups.get(pc) ?? []), r]);
        }
        // Əməkdaşın ilk qəbul tarixi (ailə üzvlərinin qeydiyyat tarixi qaydası üçün)
        const hireDates = new Map<string, Date>();
        const emps = await db.employment.findMany({ select: { hireDate: true, person: { select: { code: true } } }, orderBy: { hireDate: "asc" } });
        for (const e of emps) if (!hireDates.has(e.person.code)) hireDates.set(e.person.code, e.hireDate);

        for (const [personCode, group] of groups) {
          if (group.some((r) => r.status === "INVALID")) continue; // qrup tam etibarlı olmalıdır
          const ids = group.map((r) => r.id);
          try {
            const personId = need(lk.persons, personCode, "Əməkdaş");
            await db.$transaction((tx) => replacePersonList(tx, sheet, personId, group.map((r) => r.data), hireDates.get(personCode) ?? null));
            await markCommitted(db, ids);
            committed += ids.length;
          } catch (e) {
            await markFailed(db, ids, errMessage(e));
            failed += ids.length;
          }
          done += ids.length;
        }
        await emit(batchId, { type: "commit", stage, committed: done, total });
        continue;
      }

      const valid = sheetRows.filter((r) => r.status === "VALID");
      for (let i = 0; i < valid.length; i += CHUNK) {
        const chunk = valid.slice(i, i + CHUNK);
        try {
          await db.$transaction(async (tx) => {
            for (const r of chunk) await writeEntity(tx, r, lk);
          });
          await markCommitted(db, chunk.map((r) => r.id));
          committed += chunk.length;
        } catch {
          // Tranzaksiya geri qaytarıldıqda axtarış cədvəlləri köhnəlmiş ola bilər
          Object.assign(lk, await loadLookups(db, createdBy));
          for (const r of chunk) {
            try {
              await db.$transaction((tx) => writeEntity(tx, r, lk));
              await markCommitted(db, [r.id]);
              committed++;
            } catch (e) {
              await markFailed(db, [r.id], errMessage(e));
              failed++;
            }
          }
        }
        done += chunk.length;
        await emit(batchId, { type: "commit", stage, committed: done, total });
      }
    }
  }
  return { committed, failed };
}
