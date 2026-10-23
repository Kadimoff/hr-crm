import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "ehr_session";
const PUBLIC = ["/login", "/setup"];

/**
 * Yalnız cookie-nin mövcudluğunu yoxlayır (edge runtime-da DB yoxdur).
 * Sessiyanın etibarlılığı və rollar server tərəfində `requireUser` / `assertUser` ilə yoxlanılır.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
