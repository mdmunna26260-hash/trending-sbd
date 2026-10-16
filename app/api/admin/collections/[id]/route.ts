import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdList, parseIdParam } from "@/lib/admin-id";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid collection ID" }, { status: 400 });
  /* Validate the whole list BEFORE deleting anything. Previously a malformed
     productIds — ["abc"], [null], a bare string — wiped every existing link, then
     failed to recreate any of them inside .catch(() => {}), and still answered
     {"ok":true}. The collection silently lost its products. An empty array keeps
     its original meaning (the truthiness check below leaves links untouched). */
  if (b.productIds) {
    const productIds = parseIdList(b.productIds);
    if (productIds === null) {
      return NextResponse.json({ error: "productIds must be an array of positive integers" }, { status: 400 });
    }
    await db.collectionProduct.deleteMany({ where: { collectionId: id } });
    for (const productId of productIds) {
      await db.collectionProduct.create({ data: { collectionId: id, productId } }).catch(() => {});
    }
  }
  const c = await db.collection.update({ where: { id }, data: { title: b.title === undefined ? undefined : String(b.title), subtitle: b.subtitle || null, image: b.image || null } });
  return NextResponse.json({ ok: true, collection: c });
}
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid collection ID" }, { status: 400 });
  await db.collection.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
