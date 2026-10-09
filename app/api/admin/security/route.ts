import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit, createToken, sessionCookie } from "@/lib/auth";
import { newSecret, verifyTotp, otpauthUrl, newRecoveryCodes, hashRecoveryCode } from "@/lib/totp";
import { logApp } from "@/lib/logs";

export const dynamic = "force-dynamic";

/* Admin security: two-factor (TOTP) + "log out everywhere".
   The secret is deliberately NOT written to the database during setup — it is handed to the
   browser, and only stored once a code generated from it verifies. A half-finished setup can
   therefore never lock the owner out of their own shop. */
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const user = await db.user.findUnique({ where: { id: g.user.id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const codes = (user.recoveryCodes || "").split("\n").filter(Boolean).length;
  const logins = await db.auditLog.findMany({
    where: { userEmail: user.email, action: { in: ["LOGIN", "LOGIN_2FA", "LOGIN_2FA_RECOVERY", "LOGIN_FAILED", "LOGIN_2FA_FAILED", "LOGOUT_ALL", "2FA_ENABLED", "2FA_DISABLED"] } },
    orderBy: { id: "desc" }, take: 12,
  });
  return NextResponse.json({
    ok: true,
    user: { email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion },
    twoFactorEnabled: user.twoFactorEnabled,
    recoveryCodesLeft: codes,
    logins: logins.map((l) => ({ action: l.action, at: l.createdAt, ip: l.ip })),
  });
}

export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  /* 2FA hidden (lib/features.ts) — UI nei, tai enrollment/disable action gulo-o bondho. */
  if (!FEATURES.adminTwoFactor && ["setup", "enable", "disable", "recovery"].includes(action)) {
    return NextResponse.json({ error: "Two-factor is turned off" }, { status: 403 });
  }
  const me = await db.user.findUnique({ where: { id: g.user.id } });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (action === "setup") {
    const secret = newSecret();
    const url = otpauthUrl(secret, me.email, "TRENDING'S Admin");
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    return NextResponse.json({ ok: true, secret, otpauth: url, qr, note: "Secret save hoy ni — code verify korle save hobe." });
  }

  if (action === "enable") {
    const secret = String(b.secret || "").replace(/\s/g, "");
    if (!secret) return NextResponse.json({ error: "Start the setup again — the secret is missing." }, { status: 400 });
    if (!verifyTotp(secret, String(b.code || ""))) return NextResponse.json({ error: "Ei code ta milche na. Authenticator app er current code din." }, { status: 400 });
    const codes = newRecoveryCodes(6);
    await db.user.update({
      where: { id: me.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: true, recoveryCodes: codes.map(hashRecoveryCode).join("\n") },
    });
    await logAudit(me.email, "2FA_ENABLED");
    await logApp("WARN", "WEBHOOK", `2FA enabled for ${me.email}`);
    return NextResponse.json({ ok: true, codes, message: "2FA on ✓ — recovery codes save kore rakhun." });
  }

  if (action === "disable") {
    if (!me.twoFactorEnabled) return NextResponse.json({ ok: true, message: "2FA already off." });
    const code = String(b.code || "").replace(/\s/g, "");
    const okTotp = verifyTotp(me.twoFactorSecret || "", code);
    let okRecovery = false;
    if (!okTotp && me.recoveryCodes) {
      const want = hashRecoveryCode(code);
      okRecovery = me.recoveryCodes.split("\n").some((h) => h === want);
    }
    if (!okTotp && !okRecovery) return NextResponse.json({ error: "Code dorkar — 2FA off korte current code (ba recovery code) lagbe." }, { status: 400 });
    await db.user.update({ where: { id: me.id }, data: { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: null } });
    await logAudit(me.email, "2FA_DISABLED");
    return NextResponse.json({ ok: true, message: "2FA off kora hoyeche." });
  }

  if (action === "recovery") {
    if (!me.twoFactorEnabled) return NextResponse.json({ error: "2FA on koren age." }, { status: 400 });
    if (!verifyTotp(me.twoFactorSecret || "", String(b.code || ""))) return NextResponse.json({ error: "Current authenticator code din." }, { status: 400 });
    const codes = newRecoveryCodes(6);
    await db.user.update({ where: { id: me.id }, data: { recoveryCodes: codes.map(hashRecoveryCode).join("\n") } });
    await logAudit(me.email, "2FA_RECOVERY_REGENERATED");
    return NextResponse.json({ ok: true, codes, message: "Notun recovery codes — purogulo ar kaj korbe na." });
  }

  if (action === "logout_all") {
    /* Everyone else's token dies; THIS browser gets a fresh one so the owner is not kicked out
       of the session they are standing in. */
    const updated = await db.user.update({ where: { id: me.id }, data: { sessionVersion: { increment: 1 } } });
    const token = createToken({ id: updated.id, email: updated.email, name: updated.name, role: updated.role, sv: updated.sessionVersion });
    await logAudit(me.email, "LOGOUT_ALL", `sessionVersion → ${updated.sessionVersion}`);
    const res = NextResponse.json({ ok: true, message: "Sob device theke logout hoye gelo — ei browser ta active rakhlam.", sessionVersion: updated.sessionVersion, token });
    const c = sessionCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
