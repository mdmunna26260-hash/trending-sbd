import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { updateOrder, OrderMutationError } from "@/lib/order-mutations";
import { InventoryConflictError } from "@/lib/deliver-stock";
import { ensureExtraTables } from "@/lib/db-ensure";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, props: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { id: rawId } = await props.params;
  const id = parseIdParam(rawId);
  if (id === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  await ensureExtraTables();
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ order });
}

export async function PUT(req: Request, props: Ctx) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { id: rawPutId } = await props.params;
  const id = parseIdParam(rawPutId);
  if (id === null) return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  const body = await req.json().catch(() => null);
  try {
    const order = await updateOrder(id, body, g.user.email);
    return NextResponse.json({ ok: true, order });
  } catch (e) {
    if (e instanceof OrderMutationError || e instanceof InventoryConflictError) return NextResponse.json({ error: e.message }, { status: e instanceof OrderMutationError ? e.status : 409 });
    console.error("order update failed", e);
    return NextResponse.json({ error: "Could not update the order. Please try again." }, { status: 500 });
  }
}
