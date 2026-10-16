import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { checkCourierFraud, ownCustomerStats } from "@/lib/fraudcheck";
import { steadfastFreeFraudCheck } from "@/lib/steadfast";
import { rateLimit } from "@/lib/auth";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/* Courier fraud check for one order's phone:
   - provider report (Steadfast/Pathao/RedX/… delivery history) when configured
   - our own store history always (real data, free) */
export async function POST(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  if (!rateLimit("fraudchk:" + g.user.email, 20, 60 * 1000)) {
    return NextResponse.json({ error: "Too many checks — wait a minute" }, { status: 429 });
  }
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  const order = await db.order.findUnique({ where: { id }, select: { phone: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const own = await ownCustomerStats(order.phone);
  const provider = await checkCourierFraud(order.phone);
  const stf = await steadfastFreeFraudCheck(order.phone); // FREE (merchant web login)
  return NextResponse.json({ ok: true, phone: order.phone, own, provider, stf });
}
