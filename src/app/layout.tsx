import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ChunkReloadListener } from "@/components/chunk-reload-listener";
import { ThemedToaster, ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BackCloseListener } from "@/lib/use-back-close";
import { UnsavedGuardListener } from "@/lib/use-unsaved-guard";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "ASOİU HR CRM", template: "%s · ASOİU HR CRM" },
  description: "Kadr və Əməkhaqqı İdarəetmə Sistemi",
};

/**
 * Əl ilə yaxınlaşdırma (pinch-zoom) heç vaxt bağlanmır — maximumScale / userScalable qoyulmur.
 * interactiveWidget: Android-də ekran klaviaturası açılanda səhifənin hündürlüyü (dvh) kiçilir —
 * dialoqdakı və formadakı aktiv sahə klaviaturanın altında qalmır.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="az" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} font-sans`}>
        <ThemeProvider>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
          <ThemedToaster />
          <ChunkReloadListener />
          {/* Sıra vacibdir: hər ikisi Next.js router-indən əvvəl popstate-i tutur; forma qoruyucusu birinci */}
          <UnsavedGuardListener />
          <BackCloseListener />
        </ThemeProvider>
      </body>
    </html>
  );
}
