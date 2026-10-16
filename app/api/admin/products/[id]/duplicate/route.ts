import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { slugify } from "@/lib/slug";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  try {
    const source = await db.product.findUnique({
      where: { id },
      include: { images: true, variants: true },
    });
    if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const suffix = " (Copy)";
    const slug = slugify(source.slug + suffix);
    const exists = await db.product.findUnique({ where: { slug } });
    const finalSlug = exists ? slug + "-" + Date.now().toString(36) : slug;

    const copy = await db.product.create({
      data: {
        title: source.title + suffix,
        slug: finalSlug,
        shortDesc: source.shortDesc,
        description: source.description,
        sku: source.sku ? source.sku + "-COPY" : null,
        price: source.price,
        comparePrice: source.comparePrice,
        cost: source.cost,
        stock: source.stock,
        lowStock: source.lowStock,
        status: "DRAFT",
        featured: false,
        isNew: false,
        isBestSeller: false,
        sizeChartImage: source.sizeChartImage,
        tags: source.tags,
        categoryId: source.categoryId,
        images: { create: source.images.map((img) => ({ url: img.url, alt: img.alt, position: img.position })) },
        variants: { create: source.variants.map((v) => ({ size: v.size, color: v.color, sku: v.sku ? v.sku + "-COPY" : null, price: v.price, stock: v.stock })) },
      },
      include: { images: true, variants: true },
    });
    await logAudit(g.user.email, "PRODUCT_DUPLICATED", `${source.title} → ${copy.title}`);
    return NextResponse.json({ ok: true, product: copy });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 }); }
}
