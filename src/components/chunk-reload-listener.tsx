"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

/** Error boundary-yə düşməyən chunk xətaları (naviqasiya zamanı dinamik import) — səhifə bir dəfə yenilənir */
export function ChunkReloadListener() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) reloadOnceForChunkError();
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error)) reloadOnceForChunkError();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
