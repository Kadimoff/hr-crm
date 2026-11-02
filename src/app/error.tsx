"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

/** Səhifə xətası: chunk yüklənmədisə bir dəfə avtomatik yeniləmə, əks halda Azərbaycan dilində xəta ekranı */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    if (chunk) reloadOnceForChunkError();
  }, [chunk]);

  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">{chunk ? "Sistem yeniləndi" : "Səhifəni açmaq alınmadı"}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {chunk ? "Yeni versiya yükləndi və ya bağlantı qısa müddətə kəsildi. Səhifəni yeniləyin." : "Gözlənilməz xəta baş verdi. Yenidən cəhd edin; təkrarlanarsa administratora xəbər verin."}
        {error.digest && <span className="mt-1 block font-mono text-xs">Kod: {error.digest}</span>}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => (chunk ? window.location.reload() : reset())} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {chunk ? "Səhifəni yenilə" : "Yenidən cəhd et"}
        </button>
      </div>
    </div>
  );
}
