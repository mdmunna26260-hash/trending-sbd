import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import { createCustomerToken, customerCookie } from "@/lib/customer-auth";
import { subscribeImplicit } from "@/lib/newsletter";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
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


/* Step 2 of Google (Gmail) login: exchange the code, read the profile,
   find-or-create the customer by email, then set the session cookie.
   New Google accounts get a temporary internal phone id — they can set their
   real mobile number from the Account page (used for order lookup). */
export async function GET(req: Request) {
  /* Caps how often this server can be pushed into calling Google's token endpoint on an attacker's
     behalf. Unbounded, that risks Google throttling or suspending the OAuth client itself, which
     would break login for every customer at once. The `state` cookie check further down already
     rejects forged callbacks, so this is about outbound-call volume and the find-or-create DB
     write, not about authentication. Same generous 40/10min per IP as step 1, for carrier-grade NAT. */
  if (!rateLimit(`gauth-cb:${getClientIp(req)}`, 40, 10 * 60 * 1000)) {
    /* publicBase() rather than req.url — see the same note in step 1. Behind Traefik req.url
       carries the container bind address, so a req.url-based redirect would send the shopper to
       http://0.0.0.0:3000/login instead of the real domain. */
    return NextResponse.redirect(`${publicBase(req)}/login?err=rate_limited`);
  }
  const url = new URL(req.url);
  const origin = publicBase(req);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = (() => {
    const raw = req.headers.get("cookie") || "";
    const m = raw.match(/(?:^|;\s*)sz_g_state=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  const fail = (reason: string) => NextResponse.redirect(new URL("/login?err=" + encodeURIComponent(reason), origin));

  try {
    const s = envFallback(await getSettings());
    const clientId = s.integrations?.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = s.integrations?.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) return fail("google_not_configured");
    if (!code || !state || !stateCookie || state !== stateCookie) return fail("google_state");

    // exchange code → access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: origin + "/api/auth/google/callback",
        grant_type: "authorization_code",
      }),
    });
    const token: any = await tokenRes.json();
    if (!token?.access_token) return fail("google_token");

    // profile
    const profRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + token.access_token },
    });
    const prof: any = await profRes.json();
    const email = String(prof?.email || "").toLowerCase().trim();
    if (!email || prof?.email_verified === false) return fail("google_email");

    // find existing customer by email; otherwise create one
    let customer = await db.customer.findFirst({ where: { email } });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          phone: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // temp internal id (replace from Account page)
          name: prof?.name || email.split("@")[0],
          email,
        },
      });
    }

    /* Google sign-in = verified email we can reach. Implicitly add to
       newsletter list unless they've previously unsubscribed (safe default). */
    subscribeImplicit(email).catch(() => {});

    const tokenJwt = createCustomerToken({ id: customer.id, phone: customer.phone, name: customer.name || customer.email || "Customer" });
    const res = NextResponse.redirect(new URL("/account?welcome=google", origin));
    res.cookies.set(customerCookie(tokenJwt) as any);
    res.cookies.set("sz_g_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return fail("google_error");
  }
}
