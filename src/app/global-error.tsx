"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

/** Kök layout-un özündə xəta (məs. əsas JS chunk yüklənmədi) — bir dəfə avtomatik yeniləmə */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    if (chunk) reloadOnceForChunkError();
  }, [chunk]);

  return (
    <html lang="az">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", margin: 0, padding: 24, textAlign: "center" }}>
        <div>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{chunk ? "Sistem yeniləndi" : "Səhifəni açmaq alınmadı"}</h2>
          <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Səhifəni yeniləyin; xəta təkrarlanarsa administratora xəbər verin.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 16px", borderRadius: 6, border: 0, background: "#2563eb", color: "#fff", cursor: "pointer" }}>
            Səhifəni yenilə
          </button>
        </div>
      </body>
    </html>
  );
}
