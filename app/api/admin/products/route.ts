import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
import { logAudit } from "@/lib/auth";
import { productSearchWhere } from "@/lib/search";

async function syncCollection(productId: number, slug: string, want: boolean) {
  const col = await db.collection.findUnique({ where: { slug } });
  if (!col) return;
  const ex = await db.collectionProduct.findUnique({ where: { collectionId_productId: { collectionId: col.id, productId } } });
  if (want && !ex) await db.collectionProduct.create({ data: { collectionId: col.id, productId } });
  if (!want && ex) await db.collectionProduct.delete({ where: { collectionId_productId: { collectionId: col.id, productId } } }).catch(() => {});
}

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  // ensure newer columns (colorGroupId, saleEnds etc.) exist before querying
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  // optional ?q= filter (used by the order item picker; plain listing when absent)
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const products = await db.product.findMany({
    where: q ? { AND: [productSearchWhere(q, ["title", "sku", "tags"])] } : undefined,
    include: { images: true, variants: true, category: true },
    orderBy: [{ position: "asc" }, { id: "desc" }],
    take: q ? 12 : undefined,
  });
  return NextResponse.json({ products });
}
export async function POST(req: Request) {
  // make sure newer columns (Product.soldCount etc.) exist before writing
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    if (!b.title || b.price == null) return NextResponse.json({ error: "Title and price are required" }, { status: 400 });
    /* images and variants are optional, but when present they must have the right shape.
       A non-array reached `.map` and threw a TypeError that the catch below turned into a
       500 carrying the raw message back to the client. */
    if (b.images != null && (!Array.isArray(b.images) || b.images.some((u: unknown) => typeof u !== "string" || !u.trim()))) {
      return NextResponse.json({ error: "images must be an array of non-empty URL strings" }, { status: 400 });
    }
    if (b.variants != null && (!Array.isArray(b.variants) || b.variants.some((v: unknown) => !v || typeof v !== "object" || Array.isArray(v)))) {
      return NextResponse.json({ error: "variants must be an array of objects" }, { status: 400 });
    }
    const imageUrls: string[] = Array.isArray(b.images) ? b.images : [];
    const variantRows: any[] = Array.isArray(b.variants) ? b.variants : [];
    const slug = b.slug ? slugify(b.slug) : slugify(b.title);
    const exists = await db.product.findUnique({ where: { slug } });
    const finalSlug = exists ? slug + "-" + Date.now().toString(36) : slug;
    const product = await db.product.create({
      data: {
        title: String(b.title).replace(/\s+/g, " ").trim(), slug: finalSlug,
        shortDesc: b.shortDesc ? String(b.shortDesc).replace(/\s+/g, " ").trim() : null,
        description: b.description ? String(b.description).trim() : null,
        sku: b.sku || null, barcode: b.barcode || null,
        price: Number(b.price) || 0, comparePrice: b.comparePrice ? Number(b.comparePrice) : null,
        cost: b.cost ? Number(b.cost) : null, stock: Number(b.stock) || 0, lowStock: Number(b.lowStock) || 5,
        soldCount: b.soldCount === "" || b.soldCount == null ? null : Math.max(0, Number(b.soldCount)),
      saleEnds: b.saleEnds ? new Date(b.saleEnds) : null,
      preorder: !!b.preorder,
      preorderDate: b.preorderDate ? new Date(b.preorderDate) : null,
      soldMode: b.soldMode === "random" ? "random" : "fixed",
      colorGroupId: b.colorGroupId ? Number(b.colorGroupId) : null,
      colorName: b.colorName ? String(b.colorName).trim().slice(0, 40) : null,
      colorImage: b.colorImage || null,
        status: b.status || "ACTIVE", featured: !!b.featured, tags: b.tags || null,
        sizeChartImage: b.sizeChartImage || null, badge: b.badge || null, isNew: !!b.isNew, isBestSeller: !!b.isBestSeller,
        categoryId: b.categoryId ? Number(b.categoryId) : null,
        images: { create: imageUrls.map((u: string, i: number) => ({ url: u, position: i, alt: String(b.title) })) },
        variants: { create: variantRows.map((v: any) => ({ size: v.size || null, color: v.color || null, sku: v.sku || null, price: v.price ? Number(v.price) : null, stock: Number(v.stock) || 0, image: v.image || null })) },
      },
      include: { images: true, variants: true },
    });
    // every new product goes into "new-arrivals" automatically (admin can remove it later from Catalog → ✏️ Edit)
    await syncCollection(product.id, "new-arrivals", true);
    await syncCollection(product.id, "best-sellers", !!b.isBestSeller);
    await logAudit(g.user.email, "PRODUCT_CREATED", `${product.title} (#${product.id})`);
    return NextResponse.json({ ok: true, product });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 }); }
}
