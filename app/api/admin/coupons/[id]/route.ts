import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("coupons", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid coupon ID" }, { status: 400 });
  const c = await db.coupon.update({ where: { id }, data: { active: !!b.active } });
  return NextResponse.json({ ok: true, coupon: c });
}
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("coupons", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid coupon ID" }, { status: 400 });
  await db.coupon.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
