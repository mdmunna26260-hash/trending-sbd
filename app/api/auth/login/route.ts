import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createCustomerToken, customerCookie } from "@/lib/customer-auth";
import { rateLimit, rateLimitPeek, rateLimitHit, rateLimitReset } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { ALLOW_URL_TOKEN } from "@/lib/session-token";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("custlogin:" + ip, 10, 10 * 60 * 1000)) return NextResponse.json({ error: "Too many attempts, try later." }, { status: 429 });
  try {
    const { phone, password } = await req.json();
    const cleanPhone = normalizeBDPhone(String(phone || ""));
    /* Per-account throttle on top of the per-IP one: without it a rotated-IP attacker can
       brute-force one number at leisure (10/10min per IP is trivially spread out).

       Scoped to (phone, IP) and counted on FAILURE only. Keyed on the bare phone it was
       an account-lockout DoS — 8 junk POSTs locked any customer out of their own account
       with no credential — and because every POST consumed a slot, a customer who logged
       in 8 times in 15 minutes locked themselves out too. The pair-scoped key stops
       someone else's attempts from affecting the account owner; getClientIp() is now
       proxy-hop aware so the IP half cannot be forged via X-Forwarded-For. */
    const phoneLockKey = "custlogin-em:" + cleanPhone + ":" + ip;
    if (!rateLimitPeek(phoneLockKey, 8, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    }
    const customer = await db.customer.findUnique({ where: { phone: cleanPhone } });
    // One generic message + always run a bcrypt compare: "Account pay nai" vs "Bhul password"
    // told the world which BD mobile numbers have an account here (and the missing compare made
    // the no-account path answer ~100x faster). Same pattern /api/admin/login already uses.
    const hash = customer?.password || "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBkRG0AmUfyV0JbzhX.T1BxJmWjA1u";
    const ok = await bcrypt.compare(String(password || ""), hash);
    if (!customer || !customer.password || !ok) {
      rateLimitHit(phoneLockKey, 15 * 60 * 1000);
      return NextResponse.json({ error: "Invalid phone number or password" }, { status: 401 });
    }
    rateLimitReset(phoneLockKey);
    const token = createCustomerToken({ id: customer.id, phone: customer.phone, name: customer.name || "Customer" });
    const res = NextResponse.json({ ok: true, ...(ALLOW_URL_TOKEN ? { token } : {}), user: { name: customer.name, phone: customer.phone } });
    const c = customerCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
