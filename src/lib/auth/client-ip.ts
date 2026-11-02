/**
 * Klientin IP ünvanının etibarlı təyini (brute-force limiti və audit üçün).
 *
 * X-Forwarded-For başlığını klient özü göndərə bilər; Next.js isə onu yalnız boş olduqda soketin ünvanı ilə doldurur.
 * Ona görə `instrumentation.ts` hər HTTP sorğusunda TCP soketin ünvanını {@link PEER_HEADER} başlığına yazır
 * (klientin göndərdiyi eyni adlı başlıq üzərinə yazılır — saxtalaşdırıla bilməz).
 *
 * TRUSTED_PROXY_HOPS (defolt 0 — tətbiq birbaşa portda, proxy yoxdur):
 *   0 — yalnız soketin ünvanı; X-Forwarded-For nəzərə alınmır.
 *   n — tətbiq n ardıcıl etibarlı proxy-nin (Traefik, nginx…) arxasındadır: X-Forwarded-For + soket zəncirində
 *       sağdan n-ci ünvan götürülür (ondan soldakılar klientin özü tərəfindən yazıla bilər).
 */

export const PEER_HEADER = "x-hrcrm-peer";

/** IPv4-mapped IPv6 (::ffff:1.2.3.4) → 1.2.3.4 */
export function normalizeIp(ip: string | null | undefined): string | null {
  const v = ip?.trim();
  if (!v) return null;
  return v.toLowerCase().startsWith("::ffff:") && v.includes(".") ? v.slice(7) : v;
}

export function resolveClientIp(
  h: { peer: string | null; forwardedFor: string | null; realIp?: string | null },
  trustedHops: string | number | undefined = 0,
): string | null {
  const peer = normalizeIp(h.peer);
  if (!peer) {
    // Soket başlığı yoxdur (instrumentation işləməyib, məs. test mühiti) — köhnə davranış
    return normalizeIp(h.forwardedFor?.split(",")[0]) ?? normalizeIp(h.realIp);
  }
  const hops = Math.max(0, Math.floor(Number(trustedHops) || 0));
  if (hops === 0) return peer;
  const chain = [...(h.forwardedFor ?? "").split(",").map((s) => normalizeIp(s)).filter((s): s is string => !!s), peer];
  // Next.js X-Forwarded-For boş olduqda onu soketin ünvanı ilə doldurur — təkrarı çıxarırıq
  if (chain.length >= 2 && chain[chain.length - 2] === peer && !h.forwardedFor?.includes(",")) chain.splice(chain.length - 2, 1);
  return chain[Math.max(0, chain.length - 1 - hops)] ?? peer;
}
