import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";

/**
 * Sistemdəki səhifənin tam ünvanı — çap və Excel-də orijinala link/QR üçün.
 * APP_URL (deploy-da, məs. https://hr.adnsu.az) və ya sorğunun öz host-u.
 */
export async function absoluteUrl(pathAndQuery: string): Promise<string> {
  const base = process.env.APP_URL?.replace(/\/+$/, "");
  if (base) return `${base}${pathAndQuery}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (process.env.COOKIE_SECURE === "true" ? "https" : "http");
  return `${proto}://${host}${pathAndQuery}`;
}

export const qrSvg = (url: string) => QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

export const qrPng = (url: string) => QRCode.toBuffer(url, { type: "png", margin: 1, width: 240, errorCorrectionLevel: "M" });
