/**
 * Siyahı vəziyyətinin (axtarış, filtr, səhifə) URL-də saxlanması və sürətli Azərbaycan axtarışı.
 * Mobil «geri» ilə qayıdanda, səhifə yenilənəndə və ya Android tab-ı yaddaşdan çıxarıb yenidən yükləyəndə
 * istifadəçi eyni siyahını görür.
 */

/**
 * Axtarış üçün normallaşdırma — `toLocaleLowerCase("az")` ilə eyni nəticə (I → ı, İ → i), amma
 * lokal-asılı ICU çağırışı olmadan (hər hərfdə minlərlə çağırış mobil telefonda yazını dondururdu).
 */
export function searchKey(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/** Bir neçə sahədən axtarış sətri — siyahı yüklənəndə bir dəfə hesablanır */
export function searchHaystack(parts: (string | null | undefined)[]): string {
  return parts.map(searchKey).join("\u0001");
}

/** URL parametrlərini yeniləyir (digər parametrlər qalır); serverə sorğu göndərilmir, tarixçəyə yeni qeyd yazılmır */
export function replaceUrlParams(update: Record<string, string | null | undefined>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(update)) {
    if (v === null || v === undefined || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  if (url.href === window.location.href) return;
  // null — Next.js daxili vəziyyəti köçürür, useSearchParams yenilənir
  window.history.replaceState(null, "", url);
}
