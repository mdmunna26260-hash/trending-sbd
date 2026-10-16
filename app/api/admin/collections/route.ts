import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdList } from "@/lib/admin-id";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ collections: await db.collection.findMany({ include: { _count: { select: { products: true } } }, orderBy: { id: "asc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("collections", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.title) return NextResponse.json({ error: "Title required" }, { status: 400 });
  const productIds = parseIdList(b.productIds);
  if (productIds === null) {
    return NextResponse.json({ error: "productIds must be an array of positive integers" }, { status: 400 });
  }
  const c = await db.collection.create({ data: { title: String(b.title), slug: slugify(b.slug || b.title), subtitle: b.subtitle || null, image: b.image || null, products: { create: productIds.map((productId) => ({ productId })) } } });
  return NextResponse.json({ ok: true, collection: c });
}
