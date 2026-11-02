"use client";

import { useEffect, useRef } from "react";

const MESSAGE = "Saxlanılmamış dəyişikliklər var. Səhifədən çıxılsın? Daxil etdiyiniz məlumatlar itəcək.";

/** Aktiv qoruyucular: səhifə URL-i → history.state (imtina edildikdə bərpa üçün) */
const guards = new Map<symbol, { url: string; state: unknown }>();

/**
 * Formada saxlanılmamış dəyişiklik varsa: brauzer/Android «geri», menyu və ya keçid linki, səhifəni yeniləmə / bağlama
 * zamanı təsdiq soruşulur.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirty) return;
    const id = Symbol("guard");
    const url = window.location.href;
    guards.set(id, { url, state: window.history.state as unknown });

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const to = new URL(a.href, url);
      if (to.origin !== window.location.origin || (to.pathname === window.location.pathname && to.search === window.location.search)) return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      guards.delete(id);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

/**
 * «Geri» (popstate) üçün dinləyici kök layout-da qoşulur: uşaq effektləri valideyndən əvvəl işlədiyi üçün
 * Next.js router-inin popstate dinləyicisindən ƏVVƏL qeydiyyatdan keçir (React popstate-dəki keçidi sinxron
 * render edir — sonradan qoşulan dinləyici işə düşəndə forma artıq silinmiş olur). İmtina edildikdə
 * Next.js-in dinləyicisi dayandırılır və URL geri qaytarılır — səhifə dəyişmir.
 */
export function UnsavedGuardListener() {
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const g = [...guards.values()].find((x) => x.url !== window.location.href);
      if (!g) return;
      if (window.confirm(MESSAGE)) return;
      e.stopImmediatePropagation();
      window.history.pushState(g.state, "", g.url);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return null;
}
