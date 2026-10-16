import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { logAudit } from "@/lib/auth";
import { PAYMENT_KINDS, methodLabel, paymentStatusFor, paymentSummary, summarize, type PaymentRow } from "@/lib/payments";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/* Advance / due / refund rows for one order.
   GET  → the rows + the running summary (paid, refunded, balance)
   POST → record a payment; the order's paymentStatus follows the money:
          nothing paid → PENDING, partly paid → PARTIAL?, fully → PAID. We only ever write
          PENDING/PAID/REFUNDED because those are the values the rest of the admin uses. */
export async function GET(_req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("orders", _req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  const data = await paymentSummary(id);
  if (!data.order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0)) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  if (amount > 10_000_000) return NextResponse.json({ error: "That amount looks wrong (৳" + amount + ")" }, { status: 400 });
  const kind = String(b.kind || "ADVANCE").toUpperCase();
  if (!PAYMENT_KINDS.some((k) => k.id === kind)) return NextResponse.json({ error: "Unknown payment kind: " + kind }, { status: 400 });
  const method = String(b.method || "bkash").toLowerCase();
  const order = await db.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const before = summarize(order.total, (await db.payment.findMany({ where: { orderId: id } })) as PaymentRow[]);
  const row = await db.payment.create({
    data: { orderId: id, amount, kind, method, note: b.note ? String(b.note).slice(0, 300) : null, createdBy: g.user.email },
  });

  const rows = (await db.payment.findMany({ where: { orderId: id } })) as PaymentRow[];
  const after = summarize(order.total, rows);
  const paymentStatus = paymentStatusFor(after);
  if (paymentStatus !== order.paymentStatus) await db.order.update({ where: { id }, data: { paymentStatus } });

  await logAudit(g.user.email, "ORDER_PAYMENT", `${order.code}: +৳${amount} (${kind} · ${methodLabel(method)}) → paid ৳${after.net} / due ৳${after.balance}${before.net !== after.net ? ` (was ৳${before.net})` : ""}`);
  const { notifyAdmin } = await import("@/lib/notify");
  notifyAdmin("payment", `💳 ৳${amount.toLocaleString("en-IN")} ${kind === "REFUND" ? "refunded" : "received"} — ${order.code}`,
    `${order.name} · ${methodLabel(method)} · total paid ৳${after.net.toLocaleString("en-IN")} · due ৳${after.balance.toLocaleString("en-IN")}`, order.code).catch(() => {});
  return NextResponse.json({ ok: true, row, summary: after, paymentStatus });
}

/** Undo a wrong entry (audited — the row goes away but the trail stays). */
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const pid = Number(new URL(req.url).searchParams.get("paymentId"));
  if (!pid) return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  const row = await db.payment.findUnique({ where: { id: pid } });
  const did = parseIdParam(params.id);
  if (did === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  if (!row || row.orderId !== did) return NextResponse.json({ error: "Payment not found on this order" }, { status: 404 });
  await db.payment.delete({ where: { id: pid } });
  const order = await db.order.findUnique({ where: { id: row.orderId } });
  const rows = (await db.payment.findMany({ where: { orderId: row.orderId } })) as PaymentRow[];
  const after = summarize(order?.total || 0, rows);
  /* the order has to follow the money in both directions: removing the row that made an order
     "PAID" must put it back to PARTIAL/PENDING, otherwise the ledger lies. */
  const paymentStatus = paymentStatusFor(after);
  if (order && paymentStatus !== order.paymentStatus) await db.order.update({ where: { id: order.id }, data: { paymentStatus } });
  await logAudit(g.user.email, "ORDER_PAYMENT_DELETE", `${order?.code}: removed ৳${row.amount} ${row.kind} entry → paid ৳${after.net} / due ৳${after.balance} (${paymentStatus})`);
  return NextResponse.json({ ok: true, summary: after, paymentStatus, rows });
}
