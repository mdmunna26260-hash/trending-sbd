import { NextResponse } from "next/server";
import { getSettings, envFallback } from "@/lib/settings";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import crypto from "crypto";
export const dynamic = "force-dynamic";

/* The public origin of the storefront.
   Behind Traefik the request's own Host is the container bind address (0.0.0.0:3000), and Google
   rejects that as a redirect URI ("doesn't comply with Google's OAuth 2.0 policy / invalid_request").
   Order of preference: configured site URL → forwarded host → Host header → the known domain. */
function publicBase(req: Request): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = req.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0].trim();
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
  if (host && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return `${proto}://${host}`;
  return "https://sinzooffcial.com";
}


/* Step 1 of Google (Gmail) login: redirect the customer to Google's consent page.
   Configure Client ID + Secret in Admin → Settings → Integrations first.
   The redirect URI to register in Google Console is exactly:
       https://YOUR-DOMAIN/api/auth/google/callback                                */
export async function GET(req: Request) {
  /* Before getSettings(), so a flood never reaches Postgres. 40/10min per IP: a shopper clicks
     "Continue with Google" once or twice, while the budget still absorbs a whole office or a
     carrier-grade NAT pool (routine on BD mobile data) sharing one address. Redirect rather than
     a bare 429 because this is a browser navigation, not an XHR. */
  if (!rateLimit(`gauth:${getClientIp(req)}`, 40, 10 * 60 * 1000)) {
    /* Built from publicBase(), NOT req.url: behind Traefik the request's own Host is the
       container bind address, so new URL(..., req.url) would redirect a real shopper to
       http://0.0.0.0:3000/login — a dead page — at the exact moment they were already being
       told "too many requests". publicBase() prefers NEXT_PUBLIC_SITE_URL, which the compose
       file sets to the real domain. */
    return NextResponse.redirect(`${publicBase(req)}/login?err=rate_limited`);
  }
  const s = envFallback(await getSettings());
  const clientId = s.integrations?.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
  if (!clientId) {
    /* publicBase(), not req.url — same latent bug the rate-limit redirect above had. Behind
       Traefik req.url carries the container bind address, so this sent anyone who tapped
       "Continue with Google" while the Client ID was missing to http://0.0.0.0:3000/login,
       which is a dead page in a browser rather than the intended Banglish explanation. */
    return NextResponse.redirect(`${publicBase(req)}/login?err=google_not_configured`);
  }
  const origin = publicBase(req);
  const state = crypto.randomBytes(18).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: origin + "/api/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const res = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  res.cookies.set("sz_g_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return res;
}
