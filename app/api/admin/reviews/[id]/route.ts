import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("reviews", req);
  if ("res" in g) return g.res;
  const { status, featured } = await req.json();
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid review ID" }, { status: 400 });
  const r = await db.review.update({ where: { id }, data: { status, featured: featured !== undefined ? !!featured : undefined } });
  return NextResponse.json({ ok: true, review: r });
}
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("reviews", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid review ID" }, { status: 400 });
  await db.review.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
