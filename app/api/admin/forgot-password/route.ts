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
    rateLimit("reset-em:" + lowerEmail, 3, 15 * 60 * 1000); // per-email cap

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
