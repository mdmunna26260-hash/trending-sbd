import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";

/** POST /api/admin/reset-password
 *  Body: { token, newPassword }
 *  Validates the token (single-use, 30-min TTL), hashes the new password, bumps
 *  sessionVersion so all existing sessions are invalidated, then clears the token. */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit("setpwd-ip:" + ip, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }
  try {
    const { token, newPassword } = await req.json();
    const raw = String(token || "").trim();
    const pwd = String(newPassword || "");
    if (raw.length < 20 || pwd.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    const hash = crypto.createHash("sha256").update(raw).digest("hex");

    // Look up user by hashed token, must not be expired
    const user = await db.user.findFirst({
      where: { resetToken: hash, active: true },
    });
    if (!user || !user.resetTokenExpires || new Date(user.resetTokenExpires).getTime() < Date.now()) {
      return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    }

    const bcryptHash = await bcrypt.hash(pwd, 10);
    await db.user.update({
      where: { id: user.id },
      data: {
        password: bcryptHash,
        resetToken: null,
        resetTokenExpires: null,
        sessionVersion: { increment: 1 }, // invalidate all existing sessions
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** GET /api/admin/reset-password?token=XYZ — lightweight validation for the reset
 *  page to show "invalid/expired" without submitting a password. */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const raw = (u.searchParams.get("token") || "").trim();
    if (raw.length < 20) return NextResponse.json({ valid: false });
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const user = await db.user.findFirst({ where: { resetToken: hash, active: true } });
    const valid = !!user && !!user?.resetTokenExpires && new Date(user.resetTokenExpires!).getTime() > Date.now();
    return NextResponse.json({ valid, email: valid ? user!.email : undefined });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
