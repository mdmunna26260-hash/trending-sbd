import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { sendAdminResetEmail } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/** POST /api/admin/forgot-password
 *  Body: { email }
 *  Behavior: always returns { ok: true } (no user enumeration) but only actually
 *  emails + stores a reset token when the email matches an active admin. */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("reset-ip:" + ip, 6, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  try {
    const { email } = await req.json();
    const lowerEmail = String(email || "").toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lowerEmail)) {
      // Still respond success to avoid email enumeration
      return NextResponse.json({ ok: true });
    }
    /* The result was discarded — this call was decorative: it recorded an attempt but
       never blocked on one, so every request fell through to the transporter (and in dev
       to the fake-transport log + the response body). Three resets per (address, host)
       per 15 minutes is now actually enforced, which also caps how often this endpoint
       can be used to confirm that an address belongs to an admin — the { ok: true }
       response is deliberately identical either way, but an unbounded loop still burns
       real mail quota.
       Keyed on (email, IP): one host cannot grind one mailbox, and the owner requesting
       from their own machine is not locked out by anyone else's traffic. */
    if (!rateLimit("reset-em:" + lowerEmail + ":" + ip, 3, 15 * 60 * 1000)) {
      // Same shape as the success response — a 429 here would confirm the address exists.
      return NextResponse.json({ ok: true });
    }

    // Find active admin user (case-insensitive)
    let user = await db.user.findFirst({ where: { email: lowerEmail, active: true } });
    if (!user) {
      const all = await db.user.findMany({ where: { active: true } });
      user = all.find(u => u.email.toLowerCase() === lowerEmail) || null;
    }

    // Always wait a similar amount of time so timing doesn't leak account existence.
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    const start = Date.now();

    let devPreviewUrl: string | undefined;
    let transport = false;

    if (user) {
      // Generate a 32-byte cryptographically random token. We sha256-hash it before
      // storing — the raw token is what goes out by email; the DB only holds the
      // hash, so a DB leak cannot be used to reset passwords.
      const raw = crypto.randomBytes(32).toString("hex");
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      const res = await sendAdminResetEmail(user.email, raw);
      if (res.ok) {
        await db.user.update({
          where: { id: user.id },
          data: { resetToken: hash, resetTokenExpires: expires },
        });
        if (process.env.NODE_ENV !== "production") {
          devPreviewUrl = res.devPreviewUrl;
        }
        transport = !!res.transport;
      }
    }

    await wait(Math.max(0, 600 - (Date.now() - start)));
    return NextResponse.json({
      ok: true,
      ...(process.env.NODE_ENV !== "production" && devPreviewUrl ? { devPreviewUrl } : {}),
      transportConfigured: transport,
    });
  } catch {
    return NextResponse.json({ ok: true }); // never leak error details
  }
}
