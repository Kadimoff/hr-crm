"use server";

import { Prisma, type EmploymentStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertUser } from "@/lib/auth/session";
import { audit, diff, snapshot } from "@/lib/audit";
import { DELETE_CONFIRM_WORD, matchesConfirmWord } from "@/lib/confirm";
import { prisma } from "@/lib/db";
import { finCode, optEmail } from "@/lib/validation/primitives";

export interface PersonFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

// ----------------------------------------------------------------------------
//  Forma sxemi — <input type="date"> dəyərləri YYYY-MM-DD formatındadır
// ----------------------------------------------------------------------------

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optStr = z.preprocess(blank, z.string().trim().max(300).optional());
const reqStr = (label: string) =>
  z.preprocess(blank, z.string({ required_error: `${label} boş ola bilməz` }).trim().min(1, `${label} boş ola bilməz`).max(300));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarix yanlışdır")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Tarix yanlışdır");
const reqDate = (label: string) => z.preprocess(blank, z.string({ required_error: `${label} boş ola bilməz` }).pipe(isoDate));
const optDate = z.preprocess(blank, isoDate.optional());

const formSchema = z
  .object({
    id: optStr,
    code: z.preprocess(blank, z.string().trim().regex(/^\S{1,32}$/, "Kod boşluqsuz olmalıdır (ən çox 32 simvol)").optional()),
    lastName: reqStr("Soyadı"),
    firstName: reqStr("Adı"),
    patronymic: optStr,
    gender: z.enum(["MALE", "FEMALE"], { errorMap: () => ({ message: "Cinsi seçin" }) }),
    birthDate: reqDate("Doğum tarixi"),
    maritalStatus: z.preprocess(blank, z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]).optional()),
    citizenship: optStr,
    fin: finCode,
    ssn: optStr,
    idDocType: reqStr("Sənədin növü"),
    idDocSeries: optStr,
    idDocNumber: reqStr("Sənədin nömrəsi"),
    idDocIssueDate: optDate,
    idDocIssuedBy: optStr,
    mobilePhone: optStr,
    workPhone: optStr,
    email: optEmail,
    registeredAddress: optStr,
    livingAddress: optStr,

    employmentId: optStr,
    departmentId: optStr,
    positionId: optStr,
    hireDate: optDate,
    schedule: optStr,
    paymentForm: optStr,
    baseSalary: z.preprocess(blank, z.coerce.number({ invalid_type_error: "Rəqəm daxil edin" }).min(0, "Mənfi ola bilməz").max(1_000_000).optional()),
    unitShare: z.preprocess(blank, z.coerce.number({ invalid_type_error: "Rəqəm daxil edin" }).gt(0, "0-dan böyük olmalıdır").max(2).optional()),
    status: z.preprocess(blank, z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional()),
    terminationDate: optDate,
    terminationArticle: optStr,
  })
  .superRefine((v, ctx) => {
    const today = new Date();
    if (v.birthDate > today) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "Doğum tarixi gələcəkdə ola bilməz" });
    // İş yeri bölməsi: bölmə seçilibsə, qalan məcburi sahələr də doldurulmalıdır
    if (v.departmentId || v.positionId || v.hireDate || v.baseSalary !== undefined) {
      if (!v.departmentId) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Struktur bölməni seçin" });
      if (!v.positionId) ctx.addIssue({ code: "custom", path: ["positionId"], message: "Vəzifəni seçin" });
      if (!v.hireDate) ctx.addIssue({ code: "custom", path: ["hireDate"], message: "İşə qəbul tarixi boş ola bilməz" });
      else if (v.hireDate <= v.birthDate) ctx.addIssue({ code: "custom", path: ["hireDate"], message: "İşə qəbul tarixi doğum tarixindən sonra olmalıdır" });
      if (v.baseSalary === undefined) ctx.addIssue({ code: "custom", path: ["baseSalary"], message: "Okladı daxil edin" });
    }
    if (v.status === "TERMINATED" && !v.terminationDate) ctx.addIssue({ code: "custom", path: ["terminationDate"], message: "Azad olunma tarixini daxil edin" });
    if (v.terminationDate && v.hireDate && v.terminationDate < v.hireDate)
      ctx.addIssue({ code: "custom", path: ["terminationDate"], message: "Azad olunma tarixi işə qəbuldan əvvəl ola bilməz" });
  });

type FormValues = z.infer<typeof formSchema>;

const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  code: "Bu kodla əməkdaş artıq mövcuddur",
  fin: "Bu FİN kodla şəxs artıq qeydiyyatdadır",
  ssn: "Bu SSN artıq başqa şəxsə aiddir",
};

function personData(v: FormValues) {
  return {
    lastName: v.lastName,
    firstName: v.firstName,
    patronymic: v.patronymic ?? null,
    fullName: [v.lastName, v.firstName, v.patronymic].filter(Boolean).join(" "),
    gender: v.gender,
    birthDate: v.birthDate,
    maritalStatus: v.maritalStatus ?? null,
    citizenship: v.citizenship ?? null,
    fin: v.fin,
    ssn: v.ssn ?? null,
    idDocType: v.idDocType,
    idDocSeries: v.idDocSeries ?? null,
    idDocNumber: v.idDocNumber,
    idDocIssueDate: v.idDocIssueDate ?? null,
    idDocIssuedBy: v.idDocIssuedBy ?? null,
    mobilePhone: v.mobilePhone ?? null,
    workPhone: v.workPhone ?? null,
    email: v.email ?? null,
    registeredAddress: v.registeredAddress ?? null,
    livingAddress: v.livingAddress ?? null,
  };
}

function employmentData(v: FormValues) {
  if (!v.departmentId || !v.positionId || !v.hireDate || v.baseSalary === undefined) return null;
  const status: EmploymentStatus = v.status ?? "ACTIVE";
  return {
    departmentId: v.departmentId,
    positionId: v.positionId,
    hireDate: v.hireDate,
    schedule: v.schedule ?? "5 günlük iş həftəsi",
    paymentForm: v.paymentForm ?? "Aylıq oklad",
    baseSalary: v.baseSalary,
    unitShare: v.unitShare ?? 1,
    status,
    terminationDate: status === "TERMINATED" ? (v.terminationDate ?? null) : null,
    terminationArticle: status === "TERMINATED" ? (v.terminationArticle ?? null) : null,
  };
}

/** Növbəti əməkdaş kodu: mövcud "E<rəqəm>" kodlarının ən böyüyü + 1 */
async function nextPersonCode(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(code FROM 2) AS INTEGER)) AS max FROM "Person" WHERE code ~ '^E[0-9]+$'`;
  return `E${String((rows[0]?.max ?? 0) + 1).padStart(3, "0")}`;
}

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

// ----------------------------------------------------------------------------
//  Əlavə / redaktə
// ----------------------------------------------------------------------------

export async function savePersonAction(_prev: PersonFormState, form: FormData): Promise<PersonFormState> {
  const user = await assertUser("employees.edit");
  const parsed = formSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { error: "Formada xətalar var — qeyd olunmuş sahələri düzəldin", fieldErrors };
  }
  const v = parsed.data;
  const data = personData(v);
  const emp = employmentData(v);

  let personId: string;
  try {
    personId = await prisma.$transaction(async (tx) => {
      if (!v.id) {
        const code = v.code ?? (await nextPersonCode(tx));
        const created = await tx.person.create({
          data: {
            code,
            ...data,
            createdById: user.id,
            ...(emp ? { employments: { create: { ...emp, salaryHistory: { create: { baseSalary: emp.baseSalary, validFrom: emp.hireDate } } } } } : {}),
          },
          select: { id: true },
        });
        await audit(
          {
            user,
            action: "CREATE",
            entity: "Person",
            entityId: created.id,
            summary: `Yeni əməkdaş əlavə edildi: ${data.fullName} (${code})`,
            changes: { ...snapshot({ code, ...data }), ...(emp ? { employment: snapshot(emp) } : {}) } as Prisma.InputJsonValue,
          },
          tx,
        );
        return created.id;
      }

      const before = await tx.person.findFirst({ where: { id: v.id, deletedAt: null }, include: { employments: true } });
      if (!before) throw new Error("Əməkdaş tapılmadı və ya arxivdədir");
      const changes: Record<string, [unknown, unknown]> = diff(
        Object.fromEntries(Object.keys(data).map((k) => [k, before[k as keyof typeof before]])),
        data,
      );
      if (v.code && v.code !== before.code) changes.code = [before.code, v.code];
      await tx.person.update({ where: { id: v.id }, data: { ...data, ...(v.code ? { code: v.code } : {}), updatedById: user.id } });

      if (emp) {
        const current = v.employmentId ? before.employments.find((e) => e.id === v.employmentId) : undefined;
        if (current) {
          for (const [k, pair] of Object.entries(diff(Object.fromEntries(Object.keys(emp).map((k) => [k, current[k as keyof typeof current]])), emp)))
            changes[`employment.${k}`] = pair;
          await tx.employment.update({ where: { id: current.id }, data: emp });
          // Oklad dəyişibsə — temporal tarixçə (idxaldakı qayda ilə eyni)
          if (Number(current.baseSalary) !== emp.baseSalary) {
            const today = todayUtc();
            await tx.salaryRecord.updateMany({ where: { employmentId: current.id, validTo: null }, data: { validTo: new Date(today.getTime() - 86_400_000) } });
            await tx.salaryRecord.create({ data: { employmentId: current.id, baseSalary: emp.baseSalary, validFrom: today } });
          }
        } else {
          await tx.employment.create({ data: { personId: v.id, ...emp, salaryHistory: { create: { baseSalary: emp.baseSalary, validFrom: emp.hireDate } } } });
          changes.employment = [null, snapshot(emp)];
        }
      }

      if (Object.keys(changes).length > 0) {
        await audit(
          {
            user,
            action: "UPDATE",
            entity: "Person",
            entityId: v.id,
            summary: `Əməkdaş məlumatları dəyişdirildi: ${data.fullName} (${Object.keys(changes).length} sahə)`,
            changes: changes as Prisma.InputJsonValue,
          },
          tx,
        );
      }
      return v.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta?.target as string[] | string | undefined) ?? "");
      if (target.includes("personId")) return { error: "Bu şəxs üçün eyni bölmə, vəzifə və tarixlə müqavilə artıq mövcuddur", fieldErrors: { hireDate: "Təkrarlanan müqavilə" } };
      const field = Object.keys(UNIQUE_FIELD_MESSAGES).find((f) => target.includes(f));
      if (field) return { error: UNIQUE_FIELD_MESSAGES[field], fieldErrors: { [field]: UNIQUE_FIELD_MESSAGES[field]! } };
    }
    return { error: e instanceof Error ? e.message : "Yadda saxlamaq alınmadı" };
  }

  revalidatePath("/employees");
  revalidatePath(`/employees/${personId}`);
  redirect(`/employees/${personId}?saved=${v.id ? "updated" : "created"}`);
}

// ----------------------------------------------------------------------------
//  Arxivə köçürmə ("sil" yazmaqla təsdiq) və bərpa
// ----------------------------------------------------------------------------

export async function archivePersonAction(id: string, confirmation: string): Promise<{ error?: string }> {
  const user = await assertUser("employees.edit");
  if (!matchesConfirmWord(confirmation)) return { error: `Təsdiq üçün "${DELETE_CONFIRM_WORD}" yazın` };
  const person = await prisma.person.findFirst({ where: { id, deletedAt: null }, select: { id: true, code: true, fullName: true, fin: true } });
  if (!person) return { error: "Əməkdaş tapılmadı və ya artıq arxivdədir" };

  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id }, data: { deletedAt: new Date(), deletedById: user.id } });
    await audit({ user, action: "DELETE", entity: "Person", entityId: id, summary: `Əməkdaş silindi (arxivə köçürüldü): ${person.fullName} (${person.code})`, changes: person }, tx);
  });
  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  return {};
}

export async function restorePersonAction(id: string): Promise<{ error?: string }> {
  const user = await assertUser("employees.edit");
  const person = await prisma.person.findFirst({ where: { id, deletedAt: { not: null } }, select: { fullName: true, code: true } });
  if (!person) return { error: "Arxivdə belə əməkdaş yoxdur" };
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id }, data: { deletedAt: null, deletedById: null, updatedById: user.id } });
    await audit({ user, action: "RESTORE", entity: "Person", entityId: id, summary: `Əməkdaş arxivdən bərpa edildi: ${person.fullName} (${person.code})` }, tx);
  });
  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  return {};
}

// ----------------------------------------------------------------------------
//  Struktur xəritəsindən sürətli redaktə: əlaqə + bir müqavilənin əsas sahələri
// ----------------------------------------------------------------------------

export interface QuickEditState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const quickSchema = z.object({
  personId: z.string().min(1),
  employmentId: z.string().min(1),
  mobilePhone: optStr,
  workPhone: optStr,
  email: optEmail,
  departmentId: reqStr("Struktur bölmə"),
  positionId: reqStr("Vəzifə"),
  baseSalary: z.preprocess(blank, z.coerce.number({ required_error: "Okladı daxil edin", invalid_type_error: "Rəqəm daxil edin" }).min(0, "Mənfi ola bilməz").max(1_000_000)),
  unitShare: z.preprocess(blank, z.coerce.number({ required_error: "Ştat payını daxil edin", invalid_type_error: "Rəqəm daxil edin" }).gt(0, "0-dan böyük olmalıdır").max(2)),
  // İşdən azad etmə tarix və maddə tələb etdiyi üçün yalnız tam formada
  status: z.enum(["ACTIVE", "ON_LEAVE"], { errorMap: () => ({ message: "Statusu seçin" }) }),
});

export async function quickUpdatePersonAction(_prev: QuickEditState, form: FormData): Promise<QuickEditState> {
  const user = await assertUser("employees.edit");
  const parsed = quickSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { error: "Formada xətalar var", fieldErrors };
  }
  const v = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      const person = await tx.person.findFirst({ where: { id: v.personId, deletedAt: null }, select: { fullName: true, mobilePhone: true, workPhone: true, email: true } });
      const emp = await tx.employment.findFirst({ where: { id: v.employmentId, personId: v.personId, status: { not: "TERMINATED" } } });
      if (!person || !emp) throw new Error("Əməkdaş və ya müqavilə tapılmadı");

      const personData = { mobilePhone: v.mobilePhone ?? null, workPhone: v.workPhone ?? null, email: v.email ?? null };
      const empData = { departmentId: v.departmentId, positionId: v.positionId, baseSalary: v.baseSalary, unitShare: v.unitShare, status: v.status };
      const changes: Record<string, [unknown, unknown]> = diff({ mobilePhone: person.mobilePhone, workPhone: person.workPhone, email: person.email }, personData);
      for (const [k, pair] of Object.entries(diff(Object.fromEntries(Object.keys(empData).map((k) => [k, emp[k as keyof typeof emp]])), empData))) changes[`employment.${k}`] = pair;
      if (Object.keys(changes).length === 0) return;

      await tx.person.update({ where: { id: v.personId }, data: { ...personData, updatedById: user.id } });
      await tx.employment.update({ where: { id: emp.id }, data: empData });
      // Oklad dəyişibsə — temporal tarixçə (tam formadakı qayda ilə eyni)
      if (Number(emp.baseSalary) !== v.baseSalary) {
        const today = todayUtc();
        await tx.salaryRecord.updateMany({ where: { employmentId: emp.id, validTo: null }, data: { validTo: new Date(today.getTime() - 86_400_000) } });
        await tx.salaryRecord.create({ data: { employmentId: emp.id, baseSalary: v.baseSalary, validFrom: today } });
      }
      await audit(
        {
          user,
          action: "UPDATE",
          entity: "Person",
          entityId: v.personId,
          summary: `Struktur xəritəsindən redaktə: ${person.fullName} (${Object.keys(changes).length} sahə)`,
          changes: changes as Prisma.InputJsonValue,
        },
        tx,
      );
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Bu şəxs üçün eyni bölmə, vəzifə və tarixlə müqavilə artıq mövcuddur" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return { error: "Seçilmiş bölmə və ya vəzifə mövcud deyil" };
    return { error: e instanceof Error ? e.message : "Yadda saxlamaq alınmadı" };
  }
  revalidatePath("/org-chart");
  revalidatePath("/employees");
  revalidatePath(`/employees/${v.personId}`);
  return { ok: true };
}
