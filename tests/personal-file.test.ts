import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketOf, parseThresholds } from "../src/lib/contract-rules";
import { buildPersonalIndex, type IndexSource } from "../src/lib/personal-file";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

test("Müqavilə sonu pillələri: 90/60/30 defolt, dəyişdirilə bilir; keçənlər «overdue»", () => {
  assert.deepEqual(parseThresholds(undefined), [90, 60, 30]);
  assert.deepEqual(parseThresholds("30, 90,abc,60,60"), [90, 60, 30]);
  assert.deepEqual(parseThresholds("14,7"), [14, 7]);
  assert.deepEqual(parseThresholds("0,999"), [90, 60, 30]);
  const t = [90, 60, 30];
  assert.equal(bucketOf(-1, t), "overdue");
  assert.equal(bucketOf(0, t), 30);
  assert.equal(bucketOf(30, t), 30);
  assert.equal(bucketOf(31, t), 60);
  assert.equal(bucketOf(90, t), 90);
  assert.equal(bucketOf(91, t), null);
});

test("Şəxsi işin vahid indeksi: bütün mənbələr bir siyahıda, ən yeni yuxarıda, tarixi məlum olmayan sonda", () => {
  const src: IndexSource = {
    birthDate: D("1980-05-01"),
    fullName: "Əliyev Əli",
    idDocType: null,
    idDocNumber: null,
    idDocIssueDate: null,
    educations: [{ id: "e1", educationType: "magistr", institution: "ADNSU", graduationDate: D("2004-06-30") }],
    academicDegrees: [{ id: "g1", degreeName: "Texnika üzrə fəlsəfə doktoru", awardDate: D("2010-01-15") }],
    academicTitles: [],
    workHistory: [{ id: "w1", organization: "SOCAR", position: "Mühəndis", startDate: D("2004-09-01"), endDate: D("2008-08-31") }],
    employments: [
      {
        id: "m1",
        hireDate: null,
        terminationDate: null,
        terminationArticle: null,
        isPrimary: true,
        contractType: "MUDDETLI",
        contractEndDate: D("2027-01-31"),
        position: { name: "Dosent" },
        department: { name: "Kafedra" },
        movements: [{ id: "mv1", effectiveDate: D("2024-09-01"), orderNumber: "12", orderDate: D("2024-08-20"), kind: "TRANSFER", toDepartment: "Kafedra", toPosition: null }],
        jobDescriptionAcks: [{ id: "a1", assignedAt: D("2026-11-01"), acknowledgedAt: null, reason: "Yeni versiya", jobDescription: { title: "Dosent", version: 2 } }],
      },
    ],
    absences: [{ id: "ab1", type: "UNPAID", startDate: D("2025-03-01"), endDate: D("2025-03-10"), orderNumber: "5", cancelledAt: null }],
    disabilities: [],
    attestations: [{ id: "at1", date: D("2023-05-05"), result: "Vəzifəyə uyğundur" }],
    documents: [{ id: "d1", kind: "TEHSIL", title: "Diplom", number: "A-1", documentDate: D("2004-06-30"), createdAt: D("2026-01-01"), verifiedAt: D("2026-02-01") }],
  };
  const idx = buildPersonalIndex(src);
  const sections = new Set(idx.map((r) => r.section));
  for (const s of ["identity", "education", "academic", "work", "contract", "order", "leave", "status", "ack", "document"]) assert.ok(sections.has(s as never), `bölmə ${s}`);
  // Sıra: ən yeni əvvəl, tarixsiz sonda
  assert.equal(idx[0]!.section, "ack");
  assert.equal(idx[idx.length - 1]!.date, null);
  assert.ok(idx.some((r) => r.key === "hire:m1" && /məlum deyil/.test(r.title) && /müddətli \(31\.01\.2027-dək\)/.test(r.detail)));
  assert.ok(idx.some((r) => r.key === "iddoc" && r.detail === "məlum deyil"));
  const doc = idx.find((r) => r.documentId === "d1")!;
  assert.equal(doc.verified, true);
  // Maaş məlumatı indeksdə yoxdur
  assert.ok(idx.every((r) => !/₼|AZN|oklad/i.test(r.detail)));
});
