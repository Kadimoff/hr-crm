"use client";

import { useEffect, useRef } from "react";

/**
 * Mobil «Geri» (Android geri düyməsi / brauzerin geri jesti) açıq dialoqu, menyunu və ya paneli bağlasın —
 * saytdan / səhifədən çıxmasın. Açılanda tarixçəyə eyni URL ilə bir qeyd əlavə olunur; geri basılanda
 * həmin qeyd götürülür və pəncərə bağlanır. Pəncərə düymə ilə bağlananda qeyd `history.back()` ilə silinir.
 *
 * Naviqasiya ilə bağlanma (məs. menyudan keçid, silindikdən sonra siyahıya keçid): URL artıq dəyişib —
 * `history.back()` çağırılmır (yoxsa keçidi ləğv edərdi). Belə pəncərəni naviqasiyadan ƏVVƏL bağlamayın.
 * Tarixçədə qalan köhnə qeyd geri qayıdanda <BackCloseListener /> tərəfindən avtomatik ötürülür.
 */

const KEY = "__ehrOverlay";
const openTokens = new Set<string>();
/** Özümüzün çağırdığı, hələ popstate-i gəlməmiş history.back() sayı */
let pendingBacks = 0;

function currentToken(): string | undefined {
  const s = window.history.state as Record<string, unknown> | null;
  return typeof s?.[KEY] === "string" ? (s[KEY] as string) : undefined;
}

function goBack() {
  pendingBacks++;
  window.history.back();
}

export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = Math.random().toString(36).slice(2);
    let active = false;
    let popped = false;
    let href = "";
    const onPop = () => {
      if (currentToken() === token) return; // üstdəki pəncərə bağlandı — bu açıq qalır
      popped = true;
      openTokens.delete(token);
      closeRef.current();
    };
    const start = () => {
      active = true;
      href = window.location.href;
      openTokens.add(token);
      // Next.js history.pushState-i öz daxili vəziyyəti ilə saxlayır — URL dəyişmir
      window.history.pushState({ ...(window.history.state ?? {}), [KEY]: token }, "");
      window.addEventListener("popstate", onPop);
    };
    // Əvvəlki pəncərənin «geri»si hələ icra olunmayıbsa — onu gözlə (yoxsa yeni qeyd dərhal silinərdi)
    let waiting: (() => void) | null = null;
    if (pendingBacks > 0) {
      waiting = () => {
        window.removeEventListener("popstate", waiting!);
        waiting = null;
        setTimeout(start, 0);
      };
      window.addEventListener("popstate", waiting);
    } else start();
    return () => {
      if (waiting) window.removeEventListener("popstate", waiting);
      if (!active) return;
      window.removeEventListener("popstate", onPop);
      openTokens.delete(token);
      if (!popped && currentToken() === token && window.location.href === href) goBack();
    };
  }, [open]);
}

/** Bağlanmış pəncərənin tarixçədə qalmış qeydinə geri qayıdanda onu ötürür (eyni səhifədə «boş» geri addımı olmasın) */
export function BackCloseListener() {
  useEffect(() => {
    const onPop = () => {
      if (pendingBacks > 0) pendingBacks--;
      const t = currentToken();
      if (t && !openTokens.has(t)) goBack();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return null;
}
