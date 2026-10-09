import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createToken, sessionCookie, rateLimit, logAudit, verifySessionTicket } from "@/lib/auth";
import { verifyTotp, hashRecoveryCode } from "@/lib/totp";
import { getClientIp } from "@/lib/ua";
import { ALLOW_URL_TOKEN } from "@/lib/session-token";
import { FEATURES } from "@/lib/features";

export const dynamic = "force-dynamic";

class LoginError extends Error {}

/* Consume the login ticket and, if used, the recovery code in ONE transaction.
   A read/modify/write JSON list allowed two concurrent requests to reuse the
   same ticket/code. A unique Setting key is an atomic single-use claim. */
export async function POST(req: Request) {
  /* 2FA hidden (lib/features.ts) — ei step ar nei, tai purono ticket diye keu dhukte parbe na. */
  if (!FEATURES.adminTwoFactor) return NextResponse.json({ error: "Two-factor is turned off" }, { status: 403 });
  const ip = getClientIp(req);
  if (!rateLimit("login2fa:" + ip, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  try {
    const { ticket, code } = await req.json();
    const t = verifySessionTicket(ticket);
    if (!t) return NextResponse.json({ error: "This login attempt expired — sign in again." }, { status: 401 });
    if (!rateLimit("login2fa-user:" + t.id, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    }
    const hash = crypto.createHash("sha256").update(ticket).digest("hex");
    const key = "security.usedTicket." + hash;
    const clean = String(code || "").replace(/\s/g, "");

    const result = await db.$transaction(async (tx) => {
      // Lock the account before reading recovery codes. Also reject a password
      // reset/log-out-everywhere that happened after the password login step.
      const locked = await tx.user.updateMany({
        where: { id: t.id, active: true, sessionVersion: t.sv },
        data: { sessionVersion: { increment: 0 } },
      });
      if (!locked.count) throw new LoginError("This login attempt expired — sign in again.");
      const user = await tx.user.findUnique({ where: { id: t.id } });
      if (!user?.twoFactorEnabled || !user.twoFactorSecret) throw new LoginError("Two-factor is not available for this account");

      // Keep rejecting tickets consumed by the pre-upgrade bookkeeping until
      // their short expiry passes.
      const legacy = await tx.setting.findUnique({ where: { key: "security.usedTickets" } });
      if (legacy) {
        let list: any[] = [];
        try { const parsed = JSON.parse(legacy.value); if (Array.isArray(parsed)) list = parsed; } catch {}
        if (list.some((x) => x?.h === hash.slice(0, 32) && x.exp > Date.now())) {
          throw new LoginError("This login attempt was already used — sign in again.");
        }
      }
      if (await tx.setting.findUnique({ where: { key } })) throw new LoginError("This login attempt was already used — sign in again.");

      let usedRecovery = false;
      if (!verifyTotp(user.twoFactorSecret, clean)) {
        const hashes = (user.recoveryCodes || "").split("\n").filter(Boolean);
        const want = hashRecoveryCode(clean);
        const idx = hashes.findIndex((h) => h.length === want.length && crypto.timingSafeEqual(new TextEncoder().encode(h), new TextEncoder().encode(want)));
        if (idx < 0) throw new LoginError("Code is not right (or expired — try the next one)");
        hashes.splice(idx, 1);
        await tx.user.update({ where: { id: user.id }, data: { recoveryCodes: hashes.join("\n") } });
        usedRecovery = true;
      }
      await tx.setting.create({ data: { key, value: new Date(Date.now() + 10 * 60_000).toISOString() } });
      return { user, usedRecovery };
    });

    // Expired claims cannot authenticate any more; bounded housekeeping only.
    await db.setting.deleteMany({ where: { key: { startsWith: "security.usedTicket." }, value: { lt: new Date().toISOString() } } }).catch(() => {});
    const { user, usedRecovery } = result;
    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role, sv: user.sessionVersion });
    await logAudit(user.email, usedRecovery ? "LOGIN_2FA_RECOVERY" : "LOGIN_2FA", undefined, ip);
    const res = NextResponse.json({ ok: true, ...(ALLOW_URL_TOKEN ? { token } : {}), user: { email: user.email, name: user.name, role: user.role }, usedRecovery });
    const c = sessionCookie(token);
    res.cookies.set(c.name, c.value, c);
    return res;
  } catch (e: any) {
    if (e instanceof LoginError || e?.code === "P2002") {
      return NextResponse.json({ error: e instanceof LoginError ? e.message : "This login attempt was already used — sign in again." }, { status: 401 });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
