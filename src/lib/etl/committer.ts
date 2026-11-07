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
import { PERSON_GROUP_BLOCKED, SALARY_SKIPPED, type FieldIssue, type RawRow, type SheetKey } from "../validation/types";
import { logFinanceChanges, moneyValue, pctValue, todayUtc } from "../finance-log";
import { isSalaryPrivileged, type SalaryViewer } from "../salary-privacy";
import { lockedSalaryIds, restrictedDepartmentIds } from "../salary-restriction";
import { emit } from "./progress";
import { formatAzDate } from "../validation/primitives";
import { changeFields, closeBlockers, syncKindFlags } from "../org-structure";
import { closeImpact, recomputeLevels } from "../department-changes";
import { ACK_REASON, ensureJobDescriptionAcks } from "../job-description-acks";
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

const SALARY_BLOCKED_MESSAGE = "Maaşı məxfi olan əməkdaşa yeni müqaviləni yalnız root və ya səlahiyyətli hesab idxal edə bilər";

/**
 * Maaş məxfiliyi: idxalı yazan (commit edən) istifadəçinin hüquqları. İmtiyazsızdırsa — məxfi şəxsin okladı və
 * məxfi bölmənin mövcud ştat maaşları yazılmır (sətir yazılır, maaş sahəsi atlanır, izah əlavə olunur).
 */
interface SalaryGuard {
  privileged: boolean;
  /** Okladını dəyişə bilmədiyi şəxslər (məxfilər + özü) */
  locked: Set<string>;
  /** Məxfi bölmələr (alt bölmələr daxil) */
  depts: Set<string>;
  /** Maaş sahəsi atlanmış sətirlər */
  skipped: string[];
  /** Maaş məxfiliyinə görə ümumiyyətlə yazılmamış sətirlər (kilidli şəxsə yeni müqavilə) */
  blocked: string[];
}

async function loadSalaryGuard(db: PrismaClient, actorId: string | null): Promise<SalaryGuard> {
  const actor = actorId ? await db.user.findUnique({ where: { id: actorId }, select: { role: true, personId: true, canViewRestrictedSalaries: true } }) : null;
  // Naməlum istifadəçi — ən məhdud hüquqlar
  const viewer: SalaryViewer = actor ?? { role: "DEPT_HEAD", personId: null, canViewRestrictedSalaries: false };
  if (isSalaryPrivileged(viewer)) return { privileged: true, locked: new Set(), depts: new Set(), skipped: [], blocked: [] };
  return { privileged: false, locked: await lockedSalaryIds(db, viewer), depts: await restrictedDepartmentIds(db), skipped: [], blocked: [] };
}

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

async function writeEntity(tx: Tx, row: StagedRow, lk: Lookups, guard: SalaryGuard): Promise<void> {
  const sheet = row.sheetKey;

  if (isDepartmentSheet(sheet)) {
    const r = parse(sheet, row.data);
    const parentId = r.parentCode ? need(lk.departments, r.parentCode, "Tabe olduğu bölmə") : null;
    // Məxfi bölməni (və ya onun alt bölməsini) başqa yerə daşımaq məxfiliyi götürərdi — yalnız imtiyazlı hesab
    if (!guard.privileged) {
      const current = await tx.department.findUnique({ where: { code: r.code }, select: { id: true, parentId: true } });
      if (current && guard.depts.has(current.id) && current.parentId !== parentId && !(parentId && guard.depts.has(parentId)))
        throw new CommitError("Maaşları məxfi olan bölmənin tabeliyini yalnız root və ya səlahiyyətli hesab dəyişə bilər");
    }
    const before = await tx.department.findUnique({ where: { code: r.code }, select: { id: true, name: true, parentId: true, closedOn: true, kind: true } });
    // Yeni sütunlar könüllüdür: faylda sütun yoxdursa mövcud dəyərə toxunulmur (köhnə şablonlar)
    const has = (k: string) => Object.hasOwn(row.data, k);
    const kindGiven = has("kind") && r.kind !== undefined;
    const flags = syncKindFlags({ kind: kindGiven ? r.kind : null, isFaculty: r.isFaculty, isChair: r.isChair });
    const data = {
      name: r.name,
      level: r.level,
      isFaculty: flags.isFaculty,
      isChair: flags.isChair,
      parentId,
      createdOn: r.createdOn,
      closedOn: r.closedOn ?? null,
      // Növ: sütunda verilib — o; verilməyib — fakültə/kafedra bayrağından (mövcud başqa növ saxlanılır)
      ...(kindGiven || flags.kind || !before?.kind || before.kind === "FAKULTE" || before.kind === "KAFEDRA" ? { kind: flags.kind } : {}),
      ...(has("sortOrder") ? { sortOrder: r.sortOrder ?? null } : {}),
      ...(has("isExternal") ? { isExternal: r.isExternal ?? false } : {}),
      ...(has("isGroup") ? { isGroup: r.isGroup ?? false } : {}),
      ...(has("headPositionTitle") ? { headPositionTitle: r.headPositionTitle ?? null } : {}),
      ...(has("campus") ? { campus: r.campus ?? null } : {}),
      ...(has("budgetCenter") ? { budgetCenter: r.budgetCenter ?? null } : {}),
    };
    // Bağlanma (M01-03): aktiv müqavilə və ya bağlanmamış alt bölmə varsa — rədd
    const closing = !!data.closedOn && (!before || !before.closedOn || before.closedOn.getTime() !== data.closedOn.getTime());
    if (before && closing) {
      // Alt bölmələr eyni faylda sonradan (növbəti vərəqdə) bağlana bilər — idxalda yalnız aktiv müqavilə bloklayır
      const blockers = closeBlockers({ ...(await closeImpact(tx, before.id, data.closedOn!)), openChildren: 0 });
      if (blockers.length) throw new CommitError(`Bölmə bağlana bilməz: ${blockers.join("; ")}`);
    }
    const d = await tx.department.upsert({ where: { code: r.code }, create: { code: r.code, ...data }, update: data, select: { id: true } });
    lk.departments.set(r.code, d.id);
    if (before && before.parentId !== parentId) await recomputeLevels(tx, d.id);
    // Struktur tarixçəsi (M01-01): yaradılma, ad / tabelik dəyişikliyi, bağlanma
    const after = changeFields({ name: data.name, parentId, closedOn: data.closedOn });
    const prev = before ? changeFields(before) : null;
    const today = todayUtc();
    const log: { kind: "CREATE" | "RENAME" | "MOVE" | "CLOSE"; effectiveDate: Date; before: object | null; after: object }[] = [];
    if (!prev) log.push({ kind: "CREATE", effectiveDate: r.createdOn, before: null, after });
    else {
      if (prev.name !== after.name) log.push({ kind: "RENAME", effectiveDate: today, before: { name: prev.name }, after: { name: after.name } });
      if (prev.parentId !== after.parentId) log.push({ kind: "MOVE", effectiveDate: today, before: { parentId: prev.parentId }, after: { parentId: after.parentId } });
      if (closing) log.push({ kind: "CLOSE", effectiveDate: data.closedOn!, before: { closedOn: prev.closedOn }, after: { closedOn: after.closedOn } });
    }
    if (log.length)
      await tx.departmentChange.createMany({
        data: log.map((c) => ({ departmentId: d.id, kind: c.kind, effectiveDate: c.effectiveDate, before: (c.before ?? undefined) as Prisma.InputJsonValue | undefined, after: c.after as Prisma.InputJsonValue, source: "IMPORT", appliedAt: new Date(), createdById: lk.userId })),
      });
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
      const before = await tx.position.findUnique({ where: { code: r.code }, select: { id: true, hazardousAllowancePct: true } });
      const p = await tx.position.upsert({ where: { code: r.code }, create: { code: r.code, ...data }, update: data, select: { id: true } });
      lk.positions.set(r.code, p.id);
      // Zərərli şərait faizi vəzifədən gəlir — dəyişibsə, həmin vəzifədəki hər aktiv müqavilənin maliyyə tarixçəsinə
      if (before && pctValue(before.hazardousAllowancePct) !== pctValue(data.hazardousAllowancePct)) {
        const emps = await tx.employment.findMany({ where: { positionId: p.id, status: { not: "TERMINATED" } }, select: { id: true, personId: true } });
        for (const e of emps)
          await logFinanceChanges(tx, { personId: e.personId, employmentId: e.id, effectiveDate: todayUtc(), source: "IMPORT", userId: lk.userId }, [
            { field: "HAZARDOUS_PCT", oldValue: pctValue(before.hazardousAllowancePct), newValue: pctValue(data.hazardousAllowancePct) },
          ]);
      }
      return;
    }
    case "staffing": {
      const r = parse("staffing", row.data);
      const departmentId = need(lk.departments, r.departmentCode, "Bölmə");
      const positionId = need(lk.positions, r.positionCode, "Vəzifə");
      const data = { unitCount: r.unitCount, minSalary: r.minSalary, maxSalary: r.maxSalary, salaryType: r.salaryType ?? null, schedule: r.schedule };
      const where = { periodDate_departmentId_positionId: { periodDate: r.periodDate, departmentId, positionId } };
      // Məxfi bölmənin mövcud ştat maaşları imtiyazsız idxalla dəyişmir (bərabər olub-olmamasından asılı olmayaraq atlanır)
      if (!guard.privileged && guard.depts.has(departmentId) && (await tx.staffingUnit.findUnique({ where, select: { id: true } }))) {
        const { minSalary: _min, maxSalary: _max, ...rest } = data;
        await tx.staffingUnit.update({ where, data: rest });
        guard.skipped.push(row.id);
        return;
      }
      await tx.staffingUnit.upsert({ where, create: { periodDate: r.periodDate, departmentId, positionId, ...data }, update: data });
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
        // Açılış stajı (DAT-02): mənbə «idxal», yoxlanılmayıb — HR sənədlə tutuşdurub təsdiqləyir
        ...(r.openingSeniorityYears !== undefined || r.openingAcademicSeniorityYears !== undefined
          ? { openingSenioritySource: `idxal ${formatAzDate(todayUtc())}`, openingSeniorityVerifiedAt: null, openingSeniorityVerifiedBy: null }
          : {}),
      };
      const before = await tx.person.findUnique({ where: { code }, select: { id: true, taxExemptionClause: true } });
      const p = await tx.person.upsert({
        where: { code },
        create: { code, ...data, createdById: lk.userId },
        update: { ...data, updatedById: lk.userId },
        select: { id: true },
      });
      lk.persons.set(code, p.id);
      // Boş xana (undefined) mövcud güzəşti dəyişmir — yalnız dəyər verilibsə müqayisə olunur
      if (before && data.taxExemptionClause !== undefined)
        await logFinanceChanges(tx, { personId: p.id, employmentId: null, effectiveDate: todayUtc(), source: "IMPORT", userId: lk.userId }, [
          { field: "TAX_EXEMPTION", oldValue: before.taxExemptionClause, newValue: data.taxExemptionClause ?? null },
        ]);
      return;
    }
    case "employments": {
      const r = parse("employments", row.data);
      const personId = need(lk.persons, r.personCode, "Əməkdaş");
      const positionId = need(lk.positions, r.positionCode, "Vəzifə");
      const departmentId = need(lk.departments, r.departmentCode, "Bölmə");
      // İşə qəbul tarixi məlum deyil (DAT-02): eyni şəxs + vəzifə + bölmə üzrə mövcud (aktiv) müqavilə həmin təyinat sayılır
      const existing = r.hireDate
        ? await tx.employment.findUnique({
            where: { personId_positionId_departmentId_hireDate: { personId, positionId, departmentId, hireDate: r.hireDate } },
            select: { id: true, baseSalary: true, unitShare: true, paymentForm: true },
          })
        : await tx.employment.findFirst({
            where: { personId, positionId, departmentId, status: { not: "TERMINATED" } },
            orderBy: { hireDate: { sort: "asc", nulls: "first" } },
            select: { id: true, baseSalary: true, unitShare: true, paymentForm: true },
          });
      // Maaş məxfiliyi: imtiyazsız istifadəçi məxfi şəxsin okladını idxalla dəyişə bilməz
      const salaryLocked = guard.locked.has(personId);
      // Boş xana mövcud dəyəri silmir (yeni müqavilədə null — «məlum deyil»)
      const salaryGiven = r.baseSalary !== undefined;
      const data = {
        ...(r.schedule !== undefined ? { schedule: r.schedule } : {}),
        ...(r.paymentForm !== undefined ? { paymentForm: r.paymentForm } : {}),
        unitShare: r.unitShare ?? 1,
        ...(salaryLocked || !salaryGiven ? {} : { baseSalary: r.baseSalary }),
      };
      // Müqavilənin növü / bitmə tarixi — könüllü sütunlar: faylda yoxdursa toxunulmur
      const contract = {
        ...(Object.hasOwn(row.data, "contractType") ? { contractType: r.contractType ?? null } : {}),
        ...(Object.hasOwn(row.data, "contractEndDate") ? { contractEndDate: r.contractEndDate ?? null } : {}),
      };
      if (!existing) {
        if (salaryLocked) {
          guard.blocked.push(row.id);
          throw new CommitError(SALARY_BLOCKED_MESSAGE);
        }
        const created = await tx.employment.create({
          data: {
            personId,
            positionId,
            departmentId,
            hireDate: r.hireDate ?? null,
            ...data,
            ...contract,
            baseSalary: r.baseSalary ?? null,
            // Oklad dövrü yalnız oklad və başlanğıc tarixi məlum olanda
            ...(r.baseSalary !== undefined && r.hireDate ? { salaryHistory: { create: { baseSalary: r.baseSalary, validFrom: r.hireDate } } } : {}),
          },
          select: { id: true },
        });
        // Qüvvədə olan vəzifə təlimatı ilə tanışlıq tapşırığı (M03-02)
        await ensureJobDescriptionAcks(tx, [created.id], ACK_REASON.HIRE);
        return;
      }
      await tx.employment.update({ where: { id: existing.id }, data: { ...data, ...contract } });
      const today = todayUtc();
      // Maliyyə tarixçəsi: idxal ilə dəyişən oklad / ştat payı / ödəniş forması — idxal günündən qüvvədə
      await logFinanceChanges(tx, { personId, employmentId: existing.id, effectiveDate: today, source: "IMPORT", userId: lk.userId }, [
        ...(salaryLocked || !salaryGiven ? [] : [{ field: "BASE_SALARY" as const, oldValue: moneyValue(existing.baseSalary), newValue: moneyValue(r.baseSalary!) }]),
        { field: "UNIT_SHARE", oldValue: moneyValue(existing.unitShare), newValue: moneyValue(data.unitShare) },
        ...(data.paymentForm !== undefined ? [{ field: "PAYMENT_FORM" as const, oldValue: existing.paymentForm, newValue: data.paymentForm }] : []),
      ]);
      // Kilidli okladın atlandığı HƏR sətirdə izah (bərabər olub-olmamasından asılı olmayaraq — cavab maaşı açmasın)
      if (salaryLocked) guard.skipped.push(row.id);
      else if (salaryGiven && (existing.baseSalary === null || Number(existing.baseSalary) !== r.baseSalary)) {
        await tx.salaryRecord.updateMany({ where: { employmentId: existing.id, validTo: null }, data: { validTo: new Date(today.getTime() - 86_400_000) } });
        await tx.salaryRecord.create({ data: { employmentId: existing.id, baseSalary: r.baseSalary!, validFrom: today } });
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

/** Elmi dərəcə / ad siyahısı dəyişibsə — maliyyə tarixçəsinə (əlavələrə təsir edir) */
async function logNamesChange(tx: Tx, personId: string, userId: string | null, field: "DEGREE" | "TITLE", before: string[], after: string[]) {
  const join = (xs: string[]) => (xs.length ? [...xs].sort((a, b) => a.localeCompare(b, "az")).join("; ") : null);
  await logFinanceChanges(tx, { personId, employmentId: null, effectiveDate: todayUtc(), source: "IMPORT", userId }, [{ field, oldValue: join(before), newValue: join(after) }]);
}

async function replacePersonList(tx: Tx, sheet: SheetKey, personId: string, raws: RawRow[], hireDate: Date | null, userId: string | null = null): Promise<void> {
  if (isAbsenceSheet(sheet)) {
    // 3 vərəq eyni cədvələ yazır — hər vərəq yalnız öz növlərini əvəz edir.
    // Dosyedən əmr ilə daxil edilmiş (orderNumber dolu) məzuniyyətlərə idxal toxunmur.
    const types = Object.values(ABSENCE_SHEETS[sheet].map) as AbsenceType[];
    await tx.absence.deleteMany({ where: { personId, type: { in: types }, orderNumber: null } });
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
      const old = await tx.academicDegree.findMany({ where: { personId }, select: { degreeName: true } });
      await tx.academicDegree.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("degrees", x));
      await logNamesChange(tx, personId, userId, "DEGREE", old.map((d) => d.degreeName), rows.map((r) => r.degreeName));
      await tx.academicDegree.createMany({
        data: rows.map(({ personCode: _p, ...r }) => ({ personId, ...r, degree: classifyDegree(r.degreeName)! })),
      });
      return;
    }
    case "titles": {
      const old = await tx.academicTitle.findMany({ where: { personId }, select: { titleName: true } });
      await tx.academicTitle.deleteMany({ where: { personId } });
      const rows = raws.map((x) => parse("titles", x));
      await logNamesChange(tx, personId, userId, "TITLE", old.map((t) => t.titleName), rows.map((r) => r.titleName));
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

/** Siyahı vərəqində şəxsin başqa sətri xətalıdır — etibarlı sətirlər yazılmır, izah (xəbərdarlıq) əlavə olunur */
async function markWaiting(db: PrismaClient, ids: string[], personCode: string, badRows: number[]) {
  if (!ids.length) return;
  const issue: FieldIssue = {
    field: "*",
    tier: "reference",
    severity: "warning",
    code: PERSON_GROUP_BLOCKED,
    relatedRows: badRows,
    message:
      `Yazılmadı, gözləyir: «${personCode || "—"}» kodlu əməkdaşın bu vərəqdəki ${badRows.length > 1 ? "sətirlərində" : "sətrində"} (${badRows.join(", ")}) xəta var. ` +
      "Siyahı vərəqləri şəxs üzrə atomik yazılır (köhnə siyahı bütövlükdə əvəz olunur) — xətalı sətir düzəldiləndə bu sətir də onunla birlikdə yazılacaq.",
  };
  // Əvvəlki «gözləyir» izahı əvəz olunur, digər xəbərdarlıqlar saxlanılır
  await db.$executeRaw`
    UPDATE "StagingRow"
    SET "errors" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("errors") e WHERE e->>'code' IS DISTINCT FROM ${PERSON_GROUP_BLOCKED}), '[]'::jsonb) || jsonb_build_array(${JSON.stringify(issue)}::jsonb),
        "updatedAt" = now()
    WHERE "id" = ANY(${ids}::text[])`;
}

async function markFailed(db: PrismaClient, ids: string[], message: string) {
  const issue: FieldIssue = { field: "*", tier: "reference", severity: "error", message: `Yazılma xətası: ${message}` };
  if (ids.length) await db.stagingRow.updateMany({ where: { id: { in: ids } }, data: { status: "INVALID", errors: [issue] as unknown as Prisma.InputJsonValue } });
}

/**
 * Commit-dən (və sonrakı yenidən yoxlamadan) sonra: siyahı vərəqlərində şəxsin başqa sətri xətalı olduğu üçün
 * yazılmamış etibarlı sətirlərə izah və xətalı sətirlərin nömrələri yazılır — istifadəçi niyə gözlədiyini görür.
 */
export async function annotateWaitingRows(db: PrismaClient, batchId: string): Promise<number> {
  const rows = (await db.stagingRow.findMany({
    where: { batchId, status: { in: ["VALID", "INVALID"] } },
    select: { id: true, sheetKey: true, rowNumber: true, status: true, data: true },
    orderBy: { rowNumber: "asc" },
  })) as { id: string; sheetKey: SheetKey; rowNumber: number; status: "VALID" | "INVALID"; data: RawRow }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!getSheet(r.sheetKey).personScoped) continue;
    const key = `${r.sheetKey}\u0000${(r.data.personCode ?? "").trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  let waiting = 0;
  for (const [key, group] of groups) {
    const bad = group.filter((r) => r.status === "INVALID").map((r) => r.rowNumber);
    const ok = group.filter((r) => r.status === "VALID").map((r) => r.id);
    if (!bad.length || !ok.length) continue;
    await markWaiting(db, ok, key.split("\u0000")[1] ?? "", bad);
    waiting += ok.length;
  }
  return waiting;
}

const errMessage = (e: unknown) =>
  e instanceof CommitError ? e.message : e instanceof Prisma.PrismaClientKnownRequestError ? `${e.code}: ${e.message.split("\n").pop()}` : String(e);

const CHUNK = 100;

/**
 * VALID sətirləri topoloji ardıcıllıqla bazaya yazır.
 * - Entity vərəqləri: 100 sətirlik tranzaksiyalar; tranzaksiya uğursuz olarsa sətir-sətir təkrar edilir və xətalı sətir ayrılır.
 * - Siyahı vərəqləri: şəxs üzrə atomik — şəxsin həmin vərəqdəki bütün sətirləri etibarlıdırsa, köhnə qeydlər əvəz olunur.
 */
export async function commitBatch(
  db: PrismaClient,
  batchId: string,
  actorId?: string,
): Promise<{ committed: number; failed: number; salarySkipped: string[]; salaryBlocked: string[] }> {
  let committed = 0;
  let failed = 0;
  const { createdBy } = await db.importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { createdBy: true } });
  const guard = await loadSalaryGuard(db, actorId ?? createdBy);

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
        const emps = await db.employment.findMany({ where: { hireDate: { not: null } }, select: { hireDate: true, person: { select: { code: true } } }, orderBy: { hireDate: "asc" } });
        for (const e of emps) if (e.hireDate && !hireDates.has(e.person.code)) hireDates.set(e.person.code, e.hireDate);

        for (const [personCode, group] of groups) {
          // Qrup tam etibarlı olmalıdır; etibarlı sətirlər gözləyir — izah commit-dən sonrakı yoxlamadan sonra yazılır (annotateWaitingRows)
          if (group.some((r) => r.status === "INVALID")) continue;
          const ids = group.map((r) => r.id);
          try {
            const personId = need(lk.persons, personCode, "Əməkdaş");
            await db.$transaction((tx) => replacePersonList(tx, sheet, personId, group.map((r) => r.data), hireDates.get(personCode) ?? null, createdBy));
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
            for (const r of chunk) await writeEntity(tx, r, lk, guard);
          });
          await markCommitted(db, chunk.map((r) => r.id));
          committed += chunk.length;
        } catch {
          // Tranzaksiya geri qaytarıldıqda axtarış cədvəlləri köhnəlmiş ola bilər
          Object.assign(lk, await loadLookups(db, createdBy));
          for (const r of chunk) {
            try {
              await db.$transaction((tx) => writeEntity(tx, r, lk, guard));
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
  return { committed, failed, salarySkipped: [...new Set(guard.skipped)], salaryBlocked: [...new Set(guard.blocked)] };
}

/**
 * Maaş məxfiliyi izahları (commit-dən sonrakı yoxlamadan SONRA — validateBatch onları silməsin):
 *  - skipped: sətir yazılıb, maaş sahəsi atlanıb (xəbərdarlıq);
 *  - blocked: sətir yazılmayıb (xəta, status INVALID) — yoxlama onu yenidən VALID etmişdi, izahsız qalırdı.
 */
export async function annotateSalarySkipped(db: PrismaClient, ids: string[], blocked: string[] = []): Promise<void> {
  if (blocked.length) {
    const err: FieldIssue = { field: "baseSalary", tier: "reference", severity: "error", code: SALARY_SKIPPED, message: SALARY_BLOCKED_MESSAGE };
    await db.$executeRaw`
      UPDATE "StagingRow"
      SET "status" = 'INVALID',
          "errors" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("errors") e WHERE e->>'code' IS DISTINCT FROM ${SALARY_SKIPPED}), '[]'::jsonb) || jsonb_build_array(${JSON.stringify(err)}::jsonb),
          "updatedAt" = now()
      WHERE "id" = ANY(${blocked}::text[]) AND "status" <> 'COMMITTED'`;
  }
  if (!ids.length) return;
  const issue: FieldIssue = {
    field: "*",
    tier: "reference",
    severity: "warning",
    code: SALARY_SKIPPED,
    message: "Sətir yazıldı, amma maaş sahəsi atlandı: bu əməkdaşın / bölmənin maaşı məxfidir — onu yalnız root və ya səlahiyyətli hesab dəyişə bilər.",
  };
  await db.$executeRaw`
    UPDATE "StagingRow"
    SET "errors" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("errors") e WHERE e->>'code' IS DISTINCT FROM ${SALARY_SKIPPED}), '[]'::jsonb) || jsonb_build_array(${JSON.stringify(issue)}::jsonb),
        "updatedAt" = now()
    WHERE "id" = ANY(${ids}::text[]) AND "status" = 'COMMITTED'`;
}
