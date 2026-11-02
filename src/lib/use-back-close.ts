"use client";

import { useEffect, useRef } from "react";

/**
 * Mobil «Geri» (Android geri düyməsi / brauzerin geri jesti) açıq dialoqu, menyunu və ya paneli bağlasın —
 * saytdan / səhifədən çıxmasın. Açılanda tarixçəyə eyni URL ilə bir qeyd əlavə olunur; geri basılanda
 * həmin qeyd götürülür və pəncərə bağlanır. Pəncərə düymə ilə bağlananda qeyd `history.back()` ilə silinir.
 *
 * Bütün popstate məntiqi <BackCloseListener />-dədir: o, kök layout-da Next.js router-indən ƏVVƏL qoşulur və
 * eyni URL daxilindəki bu «geri» addımlarını Next.js-ə ötürmür (stopImmediatePropagation). Yoxsa router hər
 * dəfə RESTORE edir və gözləyən router.refresh() / server action nəticəsini ləğv edirdi (dialoq bağlanıb
 * dərhal refresh çağırılanda məlumat yenilənmirdi).
 *
 * Naviqasiya ilə bağlanma (məs. menyudan keçid): URL artıq dəyişib — history.back() çağırılmır.
 * Belə pəncərəni naviqasiyadan ƏVVƏL bağlamayın. Tarixçədə qalan köhnə qeyd geri qayıdanda ötürülür.
 */

const KEY = "__ehrOverlay";

interface Overlay {
  token: string;
  href: string;
  close: () => void;
  popped: boolean;
}

/** Açıq pəncərələr açılma sırası ilə */
const stack: Overlay[] = [];
/** Özümüzün çağırdığı history.back()-lərin gözlənilən URL-i (null — Next.js-ə ötürülür) */
const expectedBacks: (string | null)[] = [];
/** Əvvəlki «geri» bitənə qədər açılışı gözləyən pəncərələr */
const waiters: (() => void)[] = [];

function currentToken(): string | undefined {
  const s = window.history.state as Record<string, unknown> | null;
  return typeof s?.[KEY] === "string" ? (s[KEY] as string) : undefined;
}

function goBack(expectedHref: string | null) {
  expectedBacks.push(expectedHref);
  window.history.back();
}

export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const ov: Overlay = { token: Math.random().toString(36).slice(2), href: "", close: () => closeRef.current(), popped: false };
    let started = false;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      started = true;
      ov.href = window.location.href;
      stack.push(ov);
      // Next.js history.pushState-i öz daxili vəziyyəti ilə saxlayır — URL dəyişmir
      window.history.pushState({ ...(window.history.state ?? {}), [KEY]: ov.token }, "");
    };
    if (expectedBacks.length > 0) waiters.push(start);
    else start();
    return () => {
      cancelled = true;
      if (!started) return;
      const i = stack.indexOf(ov);
      if (i >= 0) stack.splice(i, 1);
      // Düymə ilə bağlandı və hələ eyni səhifədəyik → əlavə qeyd silinir. Token-ə baxılmır: Next.js server action /
      // refresh-dən sonra cari qeydin vəziyyətini yenidən yazır (token itir), amma qeyd həmin qeyddir.
      if (!ov.popped && window.location.href === ov.href) goBack(ov.href);
    };
  }, [open]);
}

/** Kök layout-da bir dəfə — Next.js router-indən əvvəl popstate-i emal edir */
export function BackCloseListener() {
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // 1) Özümüzün history.back()-i: eyni URL — router-ə ötürülmür
      if (expectedBacks.length > 0) {
        const expected = expectedBacks.shift();
        const own = !!expected && window.location.href === expected;
        if (own) e.stopImmediatePropagation();
        if (expectedBacks.length === 0) waiters.splice(0).forEach((w) => setTimeout(w, 0));
        if (own) return;
      }
      const token = currentToken();
      // 2) İstifadəçi «geri» basdı: düşdüyümüz qeyddən yuxarıdakı pəncərələr bağlanır
      if (stack.length > 0) {
        const idx = stack.findIndex((o) => o.token === token);
        const toClose = stack.slice(idx + 1);
        if (toClose.length > 0) {
          stack.splice(idx + 1);
          const samePage = toClose.every((o) => o.href === window.location.href);
          if (samePage) e.stopImmediatePropagation();
          for (const o of toClose.reverse()) {
            o.popped = true;
            o.close();
          }
          if (samePage) return;
        }
      }
      // 3) Bağlanmış pəncərənin tarixçədə qalmış qeydinə düşdük (məs. menyudan keçiddən sonra geri) — ötürülür
      if (token && !stack.some((o) => o.token === token)) {
        e.stopImmediatePropagation();
        goBack(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return null;
}
