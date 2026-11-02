import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decryptFile, encryptFile, isEncryptedBackup, parseEncryptionKey } from "../src/lib/backup-crypto";
import { normalizeIp, resolveClientIp } from "../src/lib/auth/client-ip";
import { computePayroll, primaryEmploymentIds, type PayrollInput } from "../src/lib/calc/payroll";
import { describeMovement } from "../src/lib/movement-rules";

// ----------------------------------------------------------------------------
//  ƏH fondu: güzəşt və əlavələr şəxsə bir dəfə (əsas iş yeri), ştat payına mütənasib
// ----------------------------------------------------------------------------

const prof: Omit<PayrollInput, "baseSalary"> = { degrees: ["PHD"], titles: ["DOCENT"], hazardousAllowancePct: null, taxExemptionClause: "102.2.3" };

test("Əsas iş yeri: əlavələr və güzəştlər tətbiq olunur (köhnə davranış dəyişməyib)", () => {
  const legacy = computePayroll({ ...prof, baseSalary: 1000 });
  const primary = computePayroll({ ...prof, baseSalary: 1000, isPrimary: true, unitShare: 1 });
  assert.deepEqual(primary, legacy);
  assert.equal(primary.gross, 1200); // 1000 + 100 + 100
  // vergi: (1200 − 100 güzəşt − 200 azad) × 14% = 126
  assert.equal(primary.deductions[0]!.amount, 126);
});

test("Əvəzçilik: elmi dərəcə/ad əlavəsi, VM 102.2 güzəşti və 200 AZN azad məbləğ təkrar tətbiq olunmur", () => {
  const r = computePayroll({ ...prof, baseSalary: 500, isPrimary: false, unitShare: 0.5 });
  assert.equal(r.gross, 500);
  assert.equal(r.earnings.find((l) => l.label.startsWith("Elmi dərəcə"))!.amount, 0);
  assert.equal(r.earnings.find((l) => l.label.startsWith("Elmi ada"))!.amount, 0);
  assert.equal(r.deductions[0]!.amount, 70); // 500 × 14%, güzəştsiz
  assert.match(r.deductions[0]!.label, /əvəzçilik/);
});

test("Ştat payı: 0.5 ştatlıq əsas iş yerində əlavələr yarıya enir, tam ştatdan artıq olmur", () => {
  const half = computePayroll({ ...prof, baseSalary: 500, unitShare: 0.5 });
  assert.equal(half.gross, 600); // 500 + 50 + 50
  const over = computePayroll({ ...prof, baseSalary: 1500, unitShare: 1.5 });
  assert.equal(over.gross, 1700); // əlavələr ən çox tam ştat üzrə: 100 + 100
});

test("Fond: əsas + əvəzçilik müqaviləsi olan şəxs — əlavələr bir dəfə", () => {
  const rows = [
    { id: "a", personId: "p1", isPrimary: true, hireDate: new Date("2020-01-01"), baseSalary: 1000, unitShare: 1 },
    { id: "b", personId: "p1", isPrimary: false, hireDate: new Date("2021-01-01"), baseSalary: 500, unitShare: 0.5 },
  ];
  const primary = primaryEmploymentIds(rows);
  const fund = rows.reduce((s, e) => s + computePayroll({ ...prof, baseSalary: e.baseSalary, isPrimary: primary.has(e.id), unitShare: e.unitShare }).gross, 0);
  const before = rows.reduce((s, e) => s + computePayroll({ ...prof, baseSalary: e.baseSalary }).gross, 0); // köhnə hesablama
  assert.equal(before, 1900); // 1200 + 700 — əlavələr iki dəfə
  assert.equal(fund, 1700); // 1200 + 500
});

test("primaryEmploymentIds: hər şəxsə ən çox bir əsas müqavilə; yalnız əvəzçiliyi olana — heç biri", () => {
  const ids = primaryEmploymentIds([
    { id: "x2", personId: "p1", isPrimary: true, hireDate: new Date("2022-05-01") },
    { id: "x1", personId: "p1", isPrimary: true, hireDate: new Date("2019-05-01") },
    { id: "y1", personId: "p2", isPrimary: false, hireDate: new Date("2019-05-01") },
    { id: "z1", personId: "p3", isPrimary: true, hireDate: new Date("2019-05-01") },
  ]);
  assert.deepEqual([...ids].sort(), ["x1", "z1"]);
});

// ----------------------------------------------------------------------------
//  Klient IP-si: X-Forwarded-For saxtalaşdırılmasına qarşı
// ----------------------------------------------------------------------------

test("IP: proxy yoxdursa (defolt) klientin göndərdiyi X-Forwarded-For nəzərə alınmır", () => {
  assert.equal(resolveClientIp({ peer: "203.0.113.7", forwardedFor: "1.2.3.4" }), "203.0.113.7");
  assert.equal(resolveClientIp({ peer: "::ffff:203.0.113.7", forwardedFor: "1.2.3.4, 5.6.7.8" }, "0"), "203.0.113.7");
});

test("IP: TRUSTED_PROXY_HOPS=1 — proxy-nin əlavə etdiyi (sağdan birinci) ünvan götürülür, soldakı saxta dəyərlər yox", () => {
  assert.equal(resolveClientIp({ peer: "10.0.0.2", forwardedFor: "198.51.100.9" }, 1), "198.51.100.9");
  assert.equal(resolveClientIp({ peer: "10.0.0.2", forwardedFor: "6.6.6.6, 198.51.100.9" }, "1"), "198.51.100.9");
  // Proxy başlıq qoymayıbsa Next.js onu soketin ünvanı ilə doldurur — yenə soket
  assert.equal(resolveClientIp({ peer: "10.0.0.2", forwardedFor: "10.0.0.2" }, 1), "10.0.0.2");
});

test("IP: soket başlığı yoxdursa köhnə davranış; IPv4-mapped normallaşdırılır", () => {
  assert.equal(resolveClientIp({ peer: null, forwardedFor: "1.2.3.4, 5.6.7.8" }), "1.2.3.4");
  assert.equal(resolveClientIp({ peer: "", forwardedFor: null, realIp: "9.9.9.9" }), "9.9.9.9");
  assert.equal(normalizeIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("::1"), "::1");
});

// ----------------------------------------------------------------------------
//  Kadr hərəkəti təsviri
// ----------------------------------------------------------------------------

test("Kadr hərəkətinin növü və «əvvəl → sonra» təsviri", () => {
  const none = { fromDepartment: null, toDepartment: null, fromPosition: null, toPosition: null, fromSalary: null, toSalary: null, fromUnitShare: null, toUnitShare: null };
  assert.deepEqual(describeMovement({ ...none, fromSalary: 800, toSalary: 950.5 }), { kind: "Oklad dəyişikliyi", details: "oklad 800 ₼ → 950.5 ₼" });
  const t = describeMovement({ ...none, fromDepartment: "A", toDepartment: "B", fromSalary: 1200, toSalary: 1350 });
  assert.equal(t.kind, "Köçürmə, oklad dəyişikliyi");
  assert.equal(t.details, "A → B; oklad 1 200 ₼ → 1 350 ₼");
  assert.equal(describeMovement({ ...none, fromUnitShare: 1, toUnitShare: 0.5 }).kind, "Ştat payı dəyişikliyi");
});

// ----------------------------------------------------------------------------
//  Backup-ın şifrəli nüsxəsi (AES-256-GCM)
// ----------------------------------------------------------------------------

test("Backup şifrələmə: açar formatları", () => {
  assert.equal(parseEncryptionKey(undefined), null);
  assert.equal(parseEncryptionKey("  "), null);
  assert.equal(parseEncryptionKey("ab".repeat(32))!.length, 32);
  assert.equal(parseEncryptionKey(randomBytes(32).toString("base64"))!.length, 32);
  assert.throws(() => parseEncryptionKey("qisa"), /32 bayt/);
});

test("Backup şifrələmə: gediş-dönüş, səhv açar və dəyişdirilmiş fayl rədd edilir", async () => {
  const dir = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), "enc-test-"));
  try {
    const key = randomBytes(32);
    const plain = randomBytes(3 * 1024 * 1024 + 17); // bir neçə axın hissəsi
    const src = path.join(dir, "backup.zip");
    const enc = path.join(dir, "backup.zip.enc");
    const out = path.join(dir, "out.zip");
    await writeFile(src, plain);
    await encryptFile(src, enc, key);
    assert.equal(await isEncryptedBackup(enc), true);
    assert.equal(await isEncryptedBackup(src), false);
    const cipher = await readFile(enc);
    assert.equal(cipher.length, plain.length + 9 + 12 + 16);
    assert.equal(cipher.includes(plain.subarray(0, 64)), false);

    await decryptFile(enc, out, key);
    assert.ok((await readFile(out)).equals(plain));

    await assert.rejects(decryptFile(enc, path.join(dir, "bad.zip"), randomBytes(32)), /açar yanlışdır/);
    const tampered = Buffer.from(cipher);
    tampered[1000] = tampered[1000]! ^ 0xff;
    await writeFile(enc, tampered);
    await assert.rejects(decryptFile(enc, path.join(dir, "bad2.zip"), key), /zədələnib/);
    await assert.rejects(readFile(path.join(dir, "bad2.zip")), /ENOENT/); // yarımçıq fayl qalmır

    // Boş fayl da işləyir
    await writeFile(src, Buffer.alloc(0));
    await encryptFile(src, enc, key);
    await decryptFile(enc, out, key);
    assert.equal((await readFile(out)).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
