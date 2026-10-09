import { NextResponse, type NextRequest } from "next/server";
import { hiddenFeatureForPath } from "./lib/features";

/* Hidden features (dekho lib/features.ts) — nav theke bad dileo direct URL type korle page ta
   khule jeto. Ei middleware seta dhake: page → /admin/dashboard (token/query soho), API → 404.
   Matcher shudhu /admin + /api/admin + /api/wa dhore — storefront e kono extra kaj nei, ar
   visible admin page gulo-o ekhane keu chhoy na (hiddenFeatureForPath null dilei next()). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!hiddenFeatureForPath(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "This feature is currently hidden" }, { status: 404 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/admin/dashboard"; // query (?t=… token soho) as it is thake
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/wa/:path*", "/api/auth/google/:path*"],
};
