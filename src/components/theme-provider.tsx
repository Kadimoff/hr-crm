"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type * as React from "react";
import { Toaster } from "sonner";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="ehr-theme">
      {children}
    </NextThemesProvider>
  );
}

/** Bildirişlər aktiv temaya uyğunlaşır */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster richColors position="bottom-right" theme={resolvedTheme === "dark" ? "dark" : "light"} />;
}
