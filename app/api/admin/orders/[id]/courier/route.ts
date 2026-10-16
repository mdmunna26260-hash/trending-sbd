import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { createConsignment, checkStatusByConsignment } from "@/lib/steadfast";
import { logAudit } from "@/lib/auth";
import { emailCustomerStatus } from "@/lib/notify";
import { updateOrder } from "@/lib/order-mutations";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.courierConsignmentId) return NextResponse.json({ error: "Already sent to courier (" + order.courierConsignmentId + ")" }, { status: 400 });
  const r = await createConsignment(order);
  if (r.ok && r.data?.consignment_id) {
    await db.order.update({ where: { id: order.id }, data: { courierName: "Steadfast", courierConsignmentId: String(r.data.consignment_id), courierStatus: r.data.delivery_status || "in_review", status: order.status === "ON_HOLD" ? "SHIPPED" : order.status, courierTracking: JSON.stringify(r.data) } });
    await logAudit(g.user.email, "COURIER_SENT", `${order.code} → Steadfast consignment ${r.data.consignment_id} tracking ${r.data.tracking_code || "-"}`);
    // customer email: parcel handed to Steadfast (in review)
    if (order.email) {
      emailCustomerStatus(order.email, order.name, { code: order.code, total: order.total, area: order.area, courierName: "Steadfast" }, "in_review").catch(() => {});
    }
    // consignment created = parcel left the shop → queued "shipped" WhatsApp (worker sends it)
    if (order.status !== "ON_HOLD") {
      await import("@/lib/wa-queue").then(({ enqueueOrderEvent }) => enqueueOrderEvent(order.id, "order_shipped")).catch(() => {});
    }
    return NextResponse.json({ ok: true, consignment: r.data });
  }
  return NextResponse.json({ ok: false, configured: r.configured, error: r.error }, { status: r.configured ? 502 : 400 });
}
export async function GET(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const gid = parseIdParam(params.id);
  if (gid === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  const order = await db.order.findUnique({ where: { id: gid } });
  if (!order?.courierConsignmentId) return NextResponse.json({ error: "No courier consignment on this order" }, { status: 400 });
  const beforeStatus = order.courierStatus;
  const r = await checkStatusByConsignment(order.courierConsignmentId);
  if (r.ok) {
    const newStatus = r.data?.delivery_status || order.courierStatus;
    if (r.data?.delivery_status === "delivered" && !["CANCELLED", "RETURNED"].includes(order.status)) {
      // Same atomic status + inventory mutation as manual/bulk delivery. Do not
      // undo an admin's later return because a courier still reports delivered.
      try {
        await updateOrder(order.id, { courierStatus: newStatus, courierTracking: JSON.stringify(r.data), status: "DELIVERED", paymentStatus: "PAID" }, g.user.email);
      } catch {
        return NextResponse.json({ ok: false, error: "Delivery stock sync failed. Please retry." }, { status: 409 });
      }
    } else {
      await db.order.update({ where: { id: order.id }, data: { courierStatus: newStatus, courierTracking: JSON.stringify(r.data) } });
    }
    // customer email on rider pickup / in transit (only on transition, never repeats)
    if (order.email && newStatus && beforeStatus !== newStatus && ["picked_up", "in_transit"].includes(String(newStatus))) {
      emailCustomerStatus(order.email, order.name, { code: order.code, total: order.total, area: order.area, courierName: order.courierName }, "rider").catch(() => {});
    }
    if (r.data?.delivery_status === "cancelled" && beforeStatus !== "cancelled") {
      await logAudit(g.user.email, "COURIER_STATUS", `${order.code}: ${beforeStatus} → cancelled (Steadfast)`);
    }
  }
  return NextResponse.json({ ok: r.ok, configured: r.configured, data: r.data, error: r.error });
}
