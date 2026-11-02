/**
 * Deploy/restart zamanı köhnə səhifə yeni versiyada olmayan və ya qırılmış JS chunk-ını yükləyə bilmir
 * ("ChunkLoadError: Loading chunk … failed", net::ERR_INVALID_HTTP_RESPONSE). Belə halda səhifə bir dəfə
 * avtomatik yenilənir; sessionStorage-dakı vaxt damğası sonsuz yenilənmə dövrəsinin qarşısını alır.
 */

const KEY = "ehr:chunk-reload-at";
/** Bu müddət ərzində ikinci dəfə yenilənmir — xəta qalırsa istifadəçiyə xəta ekranı göstərilir */
const WINDOW_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(message);
}

/** Səhifəni bir dəfə yeniləyir; yeniləmə başladısa true qaytarır */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < WINDOW_MS) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage əlçatmazdırsa (məxfi rejim və s.) dövrə riskinə getmirik
    return false;
  }
  window.location.reload();
  return true;
}
