import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clean } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const col = await db.collection.findUnique({ where: { slug: params.slug }, select: { title: true, subtitle: true } });
  if (!col) return { title: "Collection not found" };
  const t = clean(col.title);
  return {
    title: t,
    description: clean(col.subtitle) || `${t} by ${"TRENDING'S"} — cash on delivery all over Bangladesh.`,
    alternates: { canonical: `/collections/${params.slug}` },
    openGraph: { type: "website", title: t, description: clean(col.subtitle) || "" },
  };
}

export default async function CollectionPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const col = await db.collection.findUnique({
    where: { slug: params.slug },
    include: {
      products: {
        include: {
          product: {
            select: {
              id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
              badge: true, isNew: true, isBestSeller: true, position: true, status: true, preorder: true,
              category: { select: { name: true } },
              images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 6 },
              // BUGFIX: variants were never loaded here → sizes & variant stock were silently ignored
              variants: { select: { size: true, color: true, stock: true } },
            },
          },
        },
      },
    },
  });
  if (!col) notFound();
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const items = col.products.filter((x: any) => x.product.status === "ACTIVE").map((x: any) => ({
    id: x.product.id, title: clean(x.product.title), slug: x.product.slug, price: x.product.price,
    comparePrice: x.product.comparePrice, image: x.product.images?.[0]?.url,
    images: (x.product.images || []).map((im: any) => im.url),
    categoryName: x.product.category?.name, stock: Math.max(x.product.stock, (x.product.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
    isNew: x.product.isNew, isBestSeller: x.product.isBestSeller, badge: x.product.badge, preorder: !!x.product.preorder,
    sizes: Array.from(new Set((x.product.variants || []).filter((v: any) => (x.product.preorder || v.stock > 0) && v.size).map((v: any) => v.size))).sort(),
  }));
  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container" style={{ padding: "38px 24px 100px" }}>
        <div className="eyebrow">Collection</div>
        <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", margin: "8px 0 6px" }}>{col.title}</h1>
        {col.subtitle && <p style={{ color: "var(--muted)", marginBottom: 30 }}>{col.subtitle}</p>}
        {items.length === 0 ? (
          /* /collections/sale used to render the headline "Up to 30% off selected styles"
             over an empty grid (and it is in the sitemap, so customers landed there from Google) */
          <div className="empty">
            <h3>This collection is being restocked</h3>
            <p>No products are in “{clean(col.title)}” right now — the full catalogue is one click away.</p>
            <br /><Link className="btn btn-outline" href="/products?onsale=1">See everything on sale</Link>
          </div>
        ) : (
          <div className="shop-grid">
            {items.map((p: any) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
