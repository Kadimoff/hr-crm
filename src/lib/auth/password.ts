import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** Format: scrypt$N$r$p$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Şifrə siyasəti: ən azı 8 simvol, hərf və rəqəm */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Şifrə ən azı 8 simvol olmalıdır";
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "Şifrədə həm hərf, həm rəqəm olmalıdır";
  return null;
}
