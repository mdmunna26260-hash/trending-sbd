import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseOrderCode } from "@/lib/slug";
import { normalizeBDPhone } from "@/lib/phone";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";

/* Order lookup is gated on (sequential order code, phone) — the right idea, but with no
   attempt limit the gate is only as strong as the phone number's secrecy. BD mobile
   numbers are 11 digits from a narrow prefix space and lists of them circulate, so an
   unthrottled loop over ORD-1…ORD-n turns this into bulk PII retrieval (name, address,
   items, totals). /api/track/courier already limits itself; this one did not. */
const BURST_MAX = 6;
const BURST_WINDOW = 60 * 1000;
const HOURLY_MAX = 30;
const HOURLY_WINDOW = 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!rateLimit("trackorder-burst:" + ip, BURST_MAX, BURST_WINDOW) ||
        !rateLimit("trackorder-hour:" + ip, HOURLY_MAX, HOURLY_WINDOW)) {
      return NextResponse.json({ error: "Too many lookups. Please try again in a few minutes." }, { status: 429 });
    }
    const { code, phone } = await req.json();
    const id = parseOrderCode(code || "");
    if (id == null || !phone) return NextResponse.json({ error: "Order not found. Check your code and phone number." }, { status: 404 });
    // normalize so 01676450711 / +8801676450711 / 8801676450711 all match
    const order = await db.order.findFirst({
      where: { id, phone: normalizeBDPhone(String(phone)) },
      select: {
        code: true, status: true, createdAt: true, area: true, subtotal: true, discount: true, deliveryFee: true, total: true,
        paymentMethod: true, paymentStatus: true, courierName: true, courierStatus: true, courierConsignmentId: true,
        items: { select: { title: true, variant: true, image: true, price: true, qty: true, preorder: true, preorderDate: true } },
      },
    });
    if (!order) return NextResponse.json({ error: "Order not found. Check your code and phone number." }, { status: 404 });
    return NextResponse.json({ order });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
