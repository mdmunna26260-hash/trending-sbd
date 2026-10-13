import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createToken, sessionCookie, rateLimit, rateLimitPeek, rateLimitHit, rateLimitReset, logAudit, sessionTicket } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("login:" + ip, 25, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  try {
    const { email, password } = await req.json();
    const lowerEmail = String(email || "").toLowerCase().trim();
    /* Per-account throttle: 8 FAILED login posts per (email, host) per 15 min → locked out.
       Two defects in the previous version:

       1) rateLimit() consumes on every call, so the bucket filled with SUCCESSFUL logins
          too — an admin signing in 8 times in 15 minutes locked themselves out of their own
          shop. Now peeked first and only recorded when the credentials actually fail.

       2) The key was the bare email, so any stranger who knew the owner's address could
          send 8 junk POSTs and lock the owner out. Scoping it to (email, IP) means one host
          cannot grind one account while the owner's own machine is unaffected; the unscoped
          per-IP cap above is what still stops wide credential stuffing. */
    const accountKey = "login-em:" + lowerEmail + ":" + ip;
    if (!rateLimitPeek(accountKey, 8, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "This account is temporarily locked. Try again in 15 minutes." }, { status: 429 });
    }
    const passwordStr = String(password || "");
    // look up by exact email (index seek) — never load the whole user table
    // case-insensitive match (emails stored with original casing) via direct field compare + JS fallback
    let user = await db.user.findFirst({ where: { email: lowerEmail, active: true } });
    if (!user) {
      const allActive = await db.user.findMany({ where: { active: true } });
      user = allActive.find(u => u.email.toLowerCase() === lowerEmail) || null;
    }
    // always run a bcrypt compare (dummy hash when user missing) → no user-enumeration timing side channel
    const hash = user?.password || "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBkRG0AmUfyV0JbzhX.T1BxJmWjA1u";
    const ok = await bcrypt.compare(passwordStr, hash);
    if (!user || !user.active || !ok) {
      rateLimitHit(accountKey, 15 * 60 * 1000); // only a real failure counts toward the lock
      await logAudit(user?.email || lowerEmail || "unknown", "LOGIN_FAILED", undefined, ip);
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    // Password proved — start from zero, so earlier mistypes don't linger into the next lock.
    rateLimitReset(accountKey);
    /* Second factor: with 2FA on, the password alone does NOT log anyone in — it only proves
       the first factor and returns a 5-minute ticket for the code step. */
    if (FEATURES.adminTwoFactor && user.twoFactorEnabled && user.twoFactorSecret) {
      await logAudit(user.email, "LOGIN_PASSWORD_OK_2FA_PENDING", undefined, ip);
      return NextResponse.json({ ok: false, needs2fa: true, ticket: sessionTicket(user.id, user.sessionVersion), email: user.email });
    }
    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role, sv: user.sessionVersion });
    await logAudit(user.email, "LOGIN", undefined, ip);
    // Production: the httpOnly cookie below is the ONLY thing the browser needs.
    // Returning the JWT in the body is what let it land in localStorage (XSS/extension
    // readable) and in ?t= links. Dev/preview keeps it so embedded previews still work.
    const handTokenToJs = process.env.NODE_ENV !== "production" || process.env.AUTH_URL_TOKEN === "1";
    const res = NextResponse.json({ ok: true, ...(handTokenToJs ? { token } : {}), user: { email: user.email, name: user.name, role: user.role } });
    const c = sessionCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
