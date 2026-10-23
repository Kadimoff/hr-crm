/**
 * Demo məlumat: fakültələr/kafedralar, vəzifələr, ştat cədvəli, ~640 əməkdaş, elmi dərəcə və adlar, məzuniyyətlər.
 * İşə salma: npm run db:seed
 * Yalnız boş bazada işləyir — əvvəlcə Verilənlər bazası səhifəsindən «Bazanı təmizlə» edin.
 */
import { randomUUID } from "node:crypto";
import { type AcademicDegreeType, type AcademicTitleType, type Prisma, PrismaClient, type StaffCategory } from "@prisma/client";

const prisma = new PrismaClient();

// Seed-li təsadüfi ədədlər — hər işə salmada eyni nəticə
let seed = 20251;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
function weighted<T>(pairs: [T, number][]): T {
  let x = rnd() * pairs.reduce((s, p) => s + p[1], 0);
  for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
  return pairs[0]![0];
}
const date = (y: number, m = 1, d = 1) => new Date(Date.UTC(y, m - 1, d));

const FACULTIES: [string, string, string[]][] = [
  ["F1", "Neft-mexanika fakültəsi", ["Neft-mədən maşınları", "Mexanika", "Materialşünaslıq"]],
  ["F2", "İnformasiya texnologiyaları və idarəetmə fakültəsi", ["Kompüter mühəndisliyi", "İnformasiya texnologiyaları", "Proseslərin avtomatlaşdırılması"]],
  ["F3", "Kimya-texnologiya fakültəsi", ["Kimya mühəndisliyi", "Neft-kimya texnologiyası"]],
  ["F4", "Geoloji-kəşfiyyat fakültəsi", ["Geologiya", "Geofizika"]],
  ["F5", "Energetika fakültəsi", ["Elektroenergetika", "İstilik energetikası"]],
  ["F6", "İqtisadiyyat və idarəetmə fakültəsi", ["Sənaye iqtisadiyyatı", "Menecment"]],
  ["RK", "Rektorluq və inzibati bölmələr", ["Kadrlar şöbəsi", "Mühasibatlıq", "Təsərrüfat şöbəsi"]],
];

// [ad, oklad, çəki, əsas məzuniyyət günü]
const POSITIONS: Record<StaffCategory, [string, number, number, number][]> = {
  PROFESSOR_MUELLIM: [
    ["Professor", 1400, 1, 56],
    ["Dosent", 1050, 3, 56],
    ["Baş müəllim", 850, 3, 56],
    ["Assistent", 700, 2, 56],
  ],
  TEDRIS_KOMEKCI: [
    ["Baş laborant", 520, 1, 30],
    ["Laborant", 450, 2, 30],
    ["Metodist", 560, 1, 30],
  ],
  INZIBATI: [
    ["Şöbə müdiri", 1100, 1, 30],
    ["Baş mütəxəssis", 780, 2, 30],
    ["Mütəxəssis", 620, 3, 30],
  ],
  XIDMETEDICI: [
    ["Texniki işçi", 345, 3, 21],
    ["Mühafizəçi", 400, 1, 21],
    ["Sürücü", 450, 1, 21],
  ],
};

const M_NAMES = ["Elçin", "Rauf", "Kamran", "Tural", "Orxan", "Vüqar", "Anar", "Rəşad", "Fərid", "Nicat", "Samir", "Elnur", "Ramil", "Cavid", "Murad"];
const F_NAMES = ["Aynur", "Günel", "Səbinə", "Leyla", "Nərmin", "Aytən", "Lalə", "Könül", "Nigar", "Sevinc", "Ülviyyə", "Fidan", "Arzu", "Türkan", "Xədicə"];
const SURNAMES = ["Əliyev", "Məmmədov", "Həsənov", "Hüseynov", "Quliyev", "İsmayılov", "Abbasov", "Kərimov", "Rzayev", "Səfərov", "Babayev", "Cəfərov", "Nəsirov", "Orucov", "Vəliyev"];

async function main() {
  if ((await prisma.person.count()) > 0 || (await prisma.department.count()) > 0) {
    console.error("Bazada artıq məlumat var. Demo məlumat yalnız boş bazaya yazılır — əvvəlcə «Verilənlər bazası → Bazanı təmizlə» edin.");
    process.exitCode = 1;
    return;
  }

  const today = new Date();
  const thisYear = today.getUTCFullYear();

  // --- Struktur ---------------------------------------------------------------
  const departments: Prisma.DepartmentCreateManyInput[] = [];
  const chairs: { id: string; admin: boolean; weight: number }[] = [];
  for (const [code, name, kids] of FACULTIES) {
    const id = randomUUID();
    const admin = code === "RK";
    departments.push({ id, code, name, level: 1, isFaculty: !admin, createdOn: date(1992) });
    kids.forEach((k, i) => {
      const kid = randomUUID();
      departments.push({ id: kid, code: `${code}-${String(i + 1).padStart(2, "0")}`, name: admin ? k : `${k} kafedrası`, level: 2, isChair: !admin, parentId: id, createdOn: date(1992) });
      chairs.push({ id: kid, admin, weight: admin ? 1.6 : code === "F2" ? 1.5 : 1 });
    });
  }

  // --- Vəzifələr --------------------------------------------------------------
  const positions: Prisma.PositionCreateManyInput[] = [];
  const posByName = new Map<string, { id: string; base: number; category: StaffCategory }>();
  let pc = 0;
  for (const [category, list] of Object.entries(POSITIONS) as [StaffCategory, (typeof POSITIONS)[StaffCategory]][]) {
    for (const [name, base, , leave] of list) {
      const id = randomUUID();
      positions.push({
        id,
        code: `V-${String(++pc).padStart(3, "0")}`,
        name,
        category: category === "XIDMETEDICI" ? "FEHLE" : "QULLUQCU",
        staffCategory: category,
        basicLeaveDays: leave,
        isPedagogical: category === "PROFESSOR_MUELLIM",
        isScientificPedagogical: category === "PROFESSOR_MUELLIM",
        isAdministrativeManagement: name === "Şöbə müdiri",
        validFrom: date(2000),
      });
      posByName.set(name, { id, base, category });
    }
  }

  // --- Şəxslər və müqavilələr -------------------------------------------------
  const persons: Prisma.PersonCreateManyInput[] = [];
  const employments: Prisma.EmploymentCreateManyInput[] = [];
  const degrees: Prisma.AcademicDegreeCreateManyInput[] = [];
  const titles: Prisma.AcademicTitleCreateManyInput[] = [];
  const absences: Prisma.AbsenceCreateManyInput[] = [];
  const filled = new Map<string, number>(); // "bölmə|vəzifə" → tutulan ştat vahidi

  const contract = (personId: string, chair: (typeof chairs)[number], unitShare: number, isPrimary: boolean) => {
    const category: StaffCategory = chair.admin
      ? weighted<StaffCategory>([["INZIBATI", 55], ["XIDMETEDICI", 40], ["TEDRIS_KOMEKCI", 5]])
      : weighted<StaffCategory>([["PROFESSOR_MUELLIM", 70], ["TEDRIS_KOMEKCI", 18], ["INZIBATI", 8], ["XIDMETEDICI", 4]]);
    const [name] = weighted(POSITIONS[category].map((p) => [p, p[2]] as [(typeof POSITIONS)[StaffCategory][number], number]));
    const pos = posByName.get(name)!;
    // Son illərdə qəbul daha çox
    const hireYear = Math.max(1982, thisYear - Math.floor(Math.abs((rnd() + rnd() + rnd() - 1.5) * 2) * 14 * rnd() + rnd() * 3));
    let hireDate = date(hireYear, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
    if (hireDate > today) hireDate = date(thisYear, 1, 1 + Math.floor(rnd() * 28));
    employments.push({
      id: randomUUID(),
      personId,
      positionId: pos.id,
      departmentId: chair.id,
      hireDate,
      schedule: unitShare < 1 ? "Natamam iş günü" : "Tam iş günü",
      paymentForm: "Aylıq vəzifə maaşı",
      baseSalary: Math.round(pos.base * unitShare),
      unitShare,
      isPrimary,
      status: isPrimary && rnd() < 0.015 ? "ON_LEAVE" : "ACTIVE",
    });
    const key = `${chair.id}|${pos.id}`;
    filled.set(key, (filled.get(key) ?? 0) + unitShare);
    return { name, hireYear };
  };

  for (let i = 1; i <= 640; i++) {
    const female = rnd() < 0.52;
    const firstName = pick(female ? F_NAMES : M_NAMES);
    const lastName = pick(SURNAMES) + (female ? "a" : "");
    const patronymic = `${pick(M_NAMES)} ${female ? "qızı" : "oğlu"}`;
    const personId = randomUUID();
    const chair = weighted(chairs.map((c) => [c, c.weight] as [(typeof chairs)[number], number]));
    const main = contract(personId, chair, rnd() < 0.9 ? 1 : 0.5, true);
    if (rnd() < 0.06) contract(personId, pick(chairs.filter((c) => c.id !== chair.id && !c.admin)), 0.5, false);

    const birthYear = main.hireYear - 22 - Math.floor(rnd() * 18);
    persons.push({
      id: personId,
      code: `ASU-${String(i).padStart(4, "0")}`,
      fullName: `${lastName} ${firstName} ${patronymic}`,
      lastName,
      firstName,
      patronymic,
      gender: female ? "FEMALE" : "MALE",
      birthDate: date(birthYear, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)),
      maritalStatus: rnd() < 0.7 ? "MARRIED" : "SINGLE",
      idDocType: "Şəxsiyyət vəsiqəsi",
      idDocSeries: "AA",
      idDocNumber: String(1_000_000 + i * 7919).slice(-7),
      fin: `D${i.toString(36).toUpperCase().padStart(6, "0")}`,
      citizenship: "Azərbaycan",
      email: `demo${i}@asoiu.edu.az`,
      extensions: { demo: true },
    });

    // Elmi dərəcə və ad — vəzifəyə uyğun ehtimallarla
    let degree: AcademicDegreeType | null = null;
    if (main.name === "Professor") degree = rnd() < 0.85 ? "DSC" : "PHD";
    else if (main.name === "Dosent") degree = rnd() < 0.93 ? "PHD" : "DSC";
    else if (main.name === "Baş müəllim") degree = rnd() < 0.45 ? "PHD" : null;
    else if (main.name === "Assistent") degree = rnd() < 0.12 ? "PHD" : null;
    else if (POSITIONS.INZIBATI.some((p) => p[0] === main.name)) degree = rnd() < 0.06 ? "PHD" : null;
    if (degree) {
      degrees.push({ personId, degree, degreeName: degree === "DSC" ? "Texnika elmləri doktoru" : "Texnika üzrə fəlsəfə doktoru", awardDate: date(Math.min(thisYear - 1, main.hireYear + 3), 6, 15) });
      if (degree === "DSC") degrees.push({ personId, degree: "PHD", degreeName: "Texnika üzrə fəlsəfə doktoru", awardDate: date(Math.max(1980, main.hireYear - 4), 6, 15) });
    }
    const title: AcademicTitleType | null = main.name === "Professor" && rnd() < 0.8 ? "PROFESSOR" : main.name === "Dosent" && rnd() < 0.7 ? "DOCENT" : null;
    if (title) titles.push({ personId, title, titleName: title === "PROFESSOR" ? "Professor" : "Dosent", awardDate: date(Math.min(thisYear - 1, main.hireYear + 5), 3, 1) });

    // Bu gün işdə olmayanlar (xəstəlik / sosial məzuniyyət)
    if (rnd() < 0.015) {
      const start = new Date(today.getTime() - Math.floor(rnd() * 10) * 86_400_000);
      absences.push({ personId, type: rnd() < 0.6 ? "SICK" : "SOCIAL_PAID", startDate: start, endDate: new Date(start.getTime() + (5 + Math.floor(rnd() * 20)) * 86_400_000) });
    }
  }

  // --- Ştat cədvəli: faktikidən bir qədər çox (vakansiyalar) --------------------
  const period = date(thisYear, 1, 1);
  const staffing: Prisma.StaffingUnitCreateManyInput[] = [...filled.entries()].map(([key, units]) => {
    const [departmentId, positionId] = key.split("|") as [string, string];
    const base = [...posByName.values()].find((p) => p.id === positionId)!.base;
    return {
      periodDate: period,
      departmentId,
      positionId,
      unitCount: Math.ceil(units * (1.02 + rnd() * 0.14) * 4) / 4,
      minSalary: base,
      maxSalary: Math.round(base * 1.4),
      schedule: "Tam iş günü",
    };
  });

  // --- İdxal tarixçəsi (son idxallar kartı üçün) ------------------------------
  const batches = [
    { files: ["5 Struktur bölmələri.xlsx", "1 Kadr Cədvəlləri.xlsx"], days: 6, rows: 1490 },
    { files: ["4 Ştat cədvəli.xlsx"], days: 3, rows: staffing.length },
    { files: ["8 Fiziki şəxsə aid məlumatlar.xlsx"], days: 1, rows: degrees.length + titles.length },
  ];

  await prisma.$transaction(
    async (tx) => {
      // Valideyndən uşağa: əvvəl fakültələr, sonra kafedralar
      await tx.department.createMany({ data: departments.filter((d) => d.level === 1) });
      await tx.department.createMany({ data: departments.filter((d) => d.level === 2) });
      await tx.position.createMany({ data: positions });
      await tx.staffingUnit.createMany({ data: staffing });
      await tx.person.createMany({ data: persons });
      await tx.employment.createMany({ data: employments });
      await tx.academicDegree.createMany({ data: degrees });
      await tx.academicTitle.createMany({ data: titles });
      await tx.absence.createMany({ data: absences });
      for (const b of batches) {
        const createdAt = new Date(today.getTime() - b.days * 86_400_000);
        await tx.importBatch.create({
          data: {
            status: "COMPLETED",
            createdAt,
            files: {
              create: b.files.map((fileName) => ({
                templateKey: "demo",
                fileName,
                storagePath: "",
                status: "COMMITTED",
                totalRows: Math.round(b.rows / b.files.length),
                validRows: Math.round(b.rows / b.files.length),
                committedRows: Math.round(b.rows / b.files.length),
                createdAt,
              })),
            },
          },
        });
      }
    },
    { timeout: 120_000 },
  );

  console.log(
    `Demo məlumat yazıldı: ${departments.length} bölmə, ${positions.length} vəzifə, ${staffing.length} ştat sətri, ${persons.length} şəxs, ${employments.length} müqavilə, ${degrees.length} elmi dərəcə, ${titles.length} elmi ad, ${absences.length} məzuniyyət.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
