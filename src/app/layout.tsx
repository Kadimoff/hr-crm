import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemedToaster, ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "ASOİU HR CRM", template: "%s · ASOİU HR CRM" },
  description: "Kadr və Əməkhaqqı İdarəetmə Sistemi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="az" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} font-sans`}>
        <ThemeProvider>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
