import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { productSearchWhere, resolveCategorySlug, clean } from "@/lib/search";
import { Header, Footer } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";
import { Suspense } from "react";
import ShopLayout from "./shop-layout";
import InfiniteGrid from "./infinite-grid";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SP = { q?: string; category?: string; min?: string; max?: string; size?: string; color?: string; avail?: string; sort?: string; onsale?: string };

export const metadata = { title: "Shop All" };

export default async function ProductsPage(props: { searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  // ensure newer columns exist before the listing queries run
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const sp = searchParams;

  const catSlugs = cats.map((c) => c.slug);
  // legacy/typo'd slugs (e.g. ?category=leather-jacket when the Category row is "lather-jacket")
  // still resolve — but an UNKNOWN slug must never silently show the whole catalogue
  const resolvedCat = resolveCategorySlug(sp.category, catSlugs);
  const catUnknown = !!sp.category && !resolvedCat;
  const activeCat = resolvedCat ? cats.find((c) => c.slug === resolvedCat) : undefined;
  const qpill = (slug?: string) => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (slug) params.set("category", slug);
    return "/products" + (params.toString() ? "?" + params.toString() : "");
  };
  const catCounts = await db.product.groupBy({ by: ["categoryId"], where: { status: "ACTIVE" }, _count: { _all: true } });
  const countMap = new Map(catCounts.map((c) => [c.categoryId, c._count._all]));
  const activeTotal = catCounts.reduce((a, c) => a + c._count._all, 0);
  // real variant sizes across active products (natural sort: 28…40, then S…XL)
  const vsRows = await db.productVariant.findMany({
    where: { stock: { gt: 0 }, product: { status: "ACTIVE" } },
    select: { size: true }, distinct: ["size"],
  });
  const allSizes = vsRows.map((v) => v.size).filter((s): s is string => !!s)
    .sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)));

  return (
    <>
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container shop-wrap">
        <div className="eyebrow">{activeCat ? "Category" : sp.q ? "Search" : "Shop"}</div>
        <h1 className="shop-title">
          {activeCat ? clean(activeCat.name) : catUnknown ? "No such category" : sp.q ? `Results for “${clean(sp.q)}”` : "All Products"}
        </h1>

        {/* quick category pills — always visible, never re-loads */}
        <div className="cat-pills">
          <Link className={"cat-pill" + (!sp.category ? " active" : "")} href={qpill(undefined)}>All{activeTotal ? ` (${activeTotal})` : ""}</Link>
          {cats.map((c) => (
            <Link key={c.slug} className={"cat-pill" + (resolvedCat === c.slug ? " active" : "")} href={qpill(c.slug)}>{clean(c.name)} ({countMap.get(c.id) || 0})</Link>
          ))}
        </div>

        {/* Only the RESULTS area enters a loading state when filters/search/sort
            change — header, pills, filter controls all stay mounted (no flash). */}
        <Suspense key={JSON.stringify(sp)} fallback={<ResultsFallback />}>
          <Results sp={{ ...sp, category: resolvedCat || undefined }} unknownCategory={catUnknown} cats={cats} sizes={allSizes} />
        </Suspense>
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}

/* Results skeleton: toolbar line + grid — same space the real results take */
function ResultsFallback() {
  return (
    <div aria-busy="true">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 20px", gap: 12 }}>
        <Skeleton className="sk-line" style={{ width: 90, margin: 0 }} />
        <Skeleton className="sk-line" style={{ width: 96, height: 38, margin: 0, borderRadius: 4 }} />
      </div>
      <ProductGridSkeleton count={8} />
    </div>
  );
}

/* The data-dependent part: products query + toolbar/filters + grid */
async function Results({ sp, cats, sizes, unknownCategory }: { sp: SP; cats: { id: number; name: string; slug: string }[]; sizes: string[]; unknownCategory?: boolean }) {
  const where: any = { status: "ACTIVE" };
  if (unknownCategory) where.id = -1; // show the empty state instead of an unfiltered catalogue
  if (sp.q) {
    const sw = productSearchWhere(sp.q); // case-insensitive on Postgres + every word must match
    if (sw) where.AND = [sw];
  }
  if (sp.category) {
    const c = cats.find((x) => x.slug === sp.category);
    if (c) where.categoryId = c.id;
  }
  if (sp.min || sp.max) {
    where.price = {};
    if (sp.min) where.price.gte = parseFloat(sp.min);
    if (sp.max) where.price.lte = parseFloat(sp.max);
  }
  if (sp.onsale === "1") where.comparePrice = { not: null, gt: 0 };
  if (sp.avail === "1") where.stock = { gt: 0 };

  const orderBy: any =
    sp.sort === "price_asc" ? { price: "asc" } :
    sp.sort === "price_desc" ? { price: "desc" } :
    sp.sort === "popular" ? { views: "desc" } :
    sp.sort === "new" ? { createdAt: "desc" } :
    sp.sort === "oldest" ? { createdAt: "asc" } :
    [{ position: "asc" }, { id: "desc" }]; // default = admin drag&drop order

  const totalMatching = await db.product.count({ where });
  // select only card fields — descriptions/tags/sku stay on the server,
  // keeping the transferred page payload small on mobile connections
  let products = await db.product.findMany({
    where, orderBy,
    select: {
      id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
      badge: true, isNew: true, isBestSeller: true, saleEnds: true, preorder: true,
      category: { select: { name: true } },
      images: { select: { url: true }, orderBy: { position: "asc" }, take: 6 },
      variants: { select: { id: true, size: true, color: true, stock: true, price: true }, orderBy: { id: "asc" } },
    },
  });

  if (sp.size) {
    products = products.filter((p) => p.variants.some((v) => v.size === sp.size && v.stock > 0));
  }
  if (sp.color) {
    products = products.filter((p) => p.variants.some((v) => (v.color || "").toLowerCase() === sp.color!.toLowerCase() && v.stock > 0));
  }

  const activeChips: { label: string; patch: Record<string, string | undefined> }[] = [];
  const chipCat = cats.find((c) => c.slug === sp.category);
  if (chipCat) activeChips.push({ label: clean(chipCat.name), patch: { category: undefined } });
  if (sp.size) activeChips.push({ label: "Size " + sp.size, patch: { size: undefined } });
  if (sp.min) activeChips.push({ label: "৳" + sp.min + "+", patch: { min: undefined } });
  if (sp.max) activeChips.push({ label: "≤ ৳" + sp.max, patch: { max: undefined } });
  if (sp.avail === "1") activeChips.push({ label: "In stock", patch: { avail: undefined } });
  if (sp.color) activeChips.push({ label: sp.color, patch: { color: undefined } });
  if (sp.onsale === "1") activeChips.push({ label: "On sale", patch: { onsale: undefined } });
  const chipQs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
    return "/products" + (params.toString() ? "?" + params.toString() : "");
  };

  return (
    <ShopLayout count={totalMatching} cats={cats.map((c) => ({ name: c.name, slug: c.slug }))} sizes={sizes}>
      {activeChips.length > 0 && (
        <div className="chips">
          {activeChips.map((c) => (
            <Link key={c.label} className="chip removable" href={chipQs(c.patch)} scroll={false}>
              {c.label} <span aria-hidden>×</span>
            </Link>
          ))}
        </div>
      )}
      {products.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>{unknownCategory
            ? "We don't have a category by that name. Browse the full catalogue below."
            : "Try different filters or browse all products."}</p>
          <br /><Link className="btn btn-outline" href="/products">Clear filters</Link>
        </div>
      ) : (
        <InfiniteGrid products={products.map((p) => ({
          id: p.id, title: clean(p.title), slug: p.slug, price: p.price, comparePrice: p.comparePrice,
          image: p.images?.[0]?.url, images: (p.images || []).map((im) => im.url), categoryName: p.category?.name, stock: Math.max(p.stock, p.variants.reduce((s, v) => s + v.stock, 0)),
          isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge, preorder: !!p.preorder,
          saleEnds: (p as any).saleEnds ? new Date((p as any).saleEnds).toISOString() : null,
          colors: Array.from(new Set(p.variants.filter((v) => (p.preorder || v.stock > 0) && v.color).map((v) => v.color!))),
          sizes: [...new Set(p.variants.filter((v) => (p.preorder || v.stock > 0) && v.size).map((v) => v.size!))].sort(),
          /* default variant for one-tap quick add: only usable when there is nothing to choose
             (<=1 size, <=1 colour), which is exactly when QuickAdd skips the popover */
          qa: (() => {
            const pick = p.variants.find((v) => v.stock > 0) || p.variants[0];
            if (!pick) return null;
            const sizes = new Set(p.variants.map((v) => v.size).filter(Boolean));
            const cols = new Set(p.variants.map((v) => v.color).filter(Boolean));
            if (sizes.size > 1 || cols.size > 1) return null;
            return { variantId: pick.id, price: pick.price || p.price, stock: pick.stock, size: pick.size, color: pick.color };
          })(),
        }))} />
      )}
    </ShopLayout>
  );
}
