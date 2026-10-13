import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { validateCoupon, CouponValidationError } from "@/lib/coupons";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";

/* Coupon codes are short, human and guessable, and this endpoint is unauthenticated.
   With no limit a script can walk the whole code space; each guess also runs one or two
   COUNT queries against Order (firstOrderOnly / perCustomer), so the same loop is a
   cheap way to put load on the database. Two budgets: a per-minute burst and an hourly
   ceiling. A real shopper applies a coupon a handful of times per session. */
const BURST_MAX = 8;
const BURST_WINDOW = 60 * 1000;
const HOURLY_MAX = 40;
const HOURLY_WINDOW = 60 * 60 * 1000;

/* Codes are created by the admin panel as uppercase alphanumerics and dashes. Anything
   else is not a coupon attempt — reject before touching the database, and never pass an
   unbounded string into a query. */
const CODE_OK = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!rateLimit("coupon-burst:" + ip, BURST_MAX, BURST_WINDOW) ||
        !rateLimit("coupon-hour:" + ip, HOURLY_MAX, HOURLY_WINDOW)) {
      return NextResponse.json({ valid: false, error: "Too many coupon attempts. Please try again in a few minutes." }, { status: 429 });
    }
    const body = await req.json();
    if (!body || typeof body !== "object" || typeof body.code !== "string" || typeof body.subtotal !== "number" || !Number.isFinite(body.subtotal) || body.subtotal < 0) {
      return NextResponse.json({ valid: false, error: "Invalid coupon request" }, { status: 400 });
    }
    const code = body.code.toUpperCase().trim();
    if (!CODE_OK.test(code)) return NextResponse.json({ valid: false, error: "Invalid coupon code" }, { status: 400 });
    const phone = body.phone ? normalizeBDPhone(String(body.phone)) : undefined;
    if (phone && !isValidBDPhone(phone)) return NextResponse.json({ valid: false, error: "Enter a valid BD mobile number" }, { status: 400 });
    const coupon = await db.coupon.findUnique({ where: { code } });
    const result = await validateCoupon(db, coupon, body.subtotal, phone);
    return NextResponse.json({ valid: true, ...result });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e instanceof CouponValidationError ? e.message : "Invalid coupon request" }, { status: e instanceof CouponValidationError ? 200 : 400 });
  }
}
