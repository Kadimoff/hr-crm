import assert from "node:assert/strict";
import { test } from "node:test";
import { searchHaystack, searchKey } from "../src/lib/list-state";

test("searchKey toLocaleLowerCase('az') ilə eyni nəticə verir (İ/I daxil)", () => {
  const samples = ["İSMAYILOV İlham", "Ilqar ISAYEV", "Məmmədova Günel Şahin qızı", "ÇƏKİÇ ÖĞRƏNCİ ÜZÜM", "ASU-0539", "AA 3660784", "Qədirli Xəyalə", ""];
  for (const s of samples) assert.equal(searchKey(s), s.toLocaleLowerCase("az"), s);
});

test("searchKey boş / null dəyərlər üçün boş sətir qaytarır", () => {
  assert.equal(searchKey(null), "");
  assert.equal(searchKey(undefined), "");
});

test("searchHaystack sahələr arasında uyğunluq yaratmır, hər sahədə axtarır", () => {
  const h = searchHaystack(["Əliyev Anar", "ASU-0001", null, "5ABC123"]);
  assert.ok(h.includes(searchKey("anar")));
  assert.ok(h.includes(searchKey("asu-0001")));
  assert.ok(h.includes("5abc123"));
  // iki sahənin birləşməsi (anar + asu) axtarışda tapılmamalıdır
  assert.ok(!h.includes("anarasu"));
});

test("1000 sətirlik axtarış (hər hərfdə) — normallaşdırma əvvəlcədən, filtr sürətli", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => searchHaystack([`Məmmədov${i} İlkin`, `ASU-${i}`, `FIN${i}`]));
  const t0 = performance.now();
  for (const q of ["m", "mə", "məm", "məmm", "məmmə", "məmməd"]) rows.filter((r) => r.includes(searchKey(q)));
  assert.ok(performance.now() - t0 < 50, "filtr 50ms-dən tez olmalıdır");
});
