import type { Metadata } from "next";
import { sanitizeHtml } from "@/lib/sanitize";
import { notFound } from "next/navigation";
import { clean } from "@/lib/search";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { readPolicy } from "@/lib/policy";
import { getCategories } from "@/lib/catalog";
import { FEATURES } from "@/lib/features";
import { Header, Footer } from "@/components/chrome";
import { ProductCard } from "@/components/parts";

import { imgSrc, PDP_WIDTHS, PDP_SIZES, PDP_SRC_WIDTH } from "@/components/img-src";
import RelatedCarousel from "@/components/related-carousel";
import ProductPageClient from "./client";
import ProductPageReviewForm from "./review-form";
import RecentlyViewedServer from "@/components/recently-viewed-server";
import Link from "next/link";

export const dynamic = "force-dynamic";
// runtime caching via CDN keeps fast; skip build-time prerender (small VPS RAM)

/* The size-chart table needs .sizechart-table for its borders and padding (globals.css
   line ~397). sanitizeHtml keeps any class the admin happened to write, so rewriting the
   root <table> opening tag — rather than prefixing a second class attribute — keeps the
   output well-formed. Runs on already-sanitised markup, so there is nothing left to
   escape; the client component renders the result verbatim and does no string surgery. */
function sizeChartHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return sanitizeHtml(raw).replace(/<table(\s[^>]*)?>/i, (_m, attrs: string) => {
    const kept = String(attrs || "").replace(/\sclass\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<table class="sizechart-table"${kept}>`;
  });
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const p = await db.product.findUnique({ where: { slug: params.slug }, include: { images: { orderBy: { position: "asc" }, take: 1 } } });
  if (!p) return { title: "Product not found" };
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");
  const url = `${base}/products/${p.slug}`;
  // DB titles carry trailing spaces ("LATHER JACKET ") → they leaked into <title> as a
  // double space and into og:title; and the share image must be the w1200 variant,
  // not the full-resolution original (Facebook crops, mobile users download ~1 MB).
  const title = clean(p.title);
  const desc = clean(p.shortDesc || p.description || "").slice(0, 155) || `${title} — TRENDING'S. Cash on delivery all over Bangladesh.`;
  const img = p.images?.[0]?.url;
  const share = img ? (/^\/api\/media\/[a-z0-9]+$/i.test(img) ? `${img}/w1200` : img) : undefined;
  return {
    title,
    description: desc,
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: {
      type: "website",
      title,
      description: desc,
      url,
      ...(share ? { images: [{ url: share.startsWith("http") ? share : base + share, width: 1200, height: 1200, alt: title }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description: desc, ...(share ? { image: share.startsWith("http") ? share : base + share } : {}) },
  };
}

export default async function PDP(props: { params: Promise<{ slug: string }>; searchParams?: Promise<any> }) {
  const params = await props.params;
  // ensure newer columns (colorGroupId, soldCount, variant image etc.) exist before querying
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const p = await db.product.findUnique({
    where: { slug: params.slug },
    include: { images: { orderBy: { position: "asc" }, select: { url: true, alt: true, position: true } }, variants: true, category: true,
      reviews: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" } } },
  });
  if (!p || p.status === "ARCHIVED") notFound();

  // TASK: color family — DB-side query on indexed colorGroupId, selector fields only
  let colorFamily: { id: number; slug: string; colorName: string | null; colorImage: string | null }[] = [];
  if (FEATURES.colorGroups && p.colorGroupId) {
    const fam = await db.product.findMany({
      where: { colorGroupId: p.colorGroupId, status: "ACTIVE", id: { not: p.id } },
      select: {
        id: true, slug: true, colorName: true, colorImage: true,
        // cover image + linked variant images → warmed on the CURRENT color's
        // page so switching colors feels instant (all in this same indexed query)
        images: { orderBy: { position: "asc" }, take: 3, select: { url: true } },
        variants: { where: { image: { not: null } }, select: { image: true }, take: 3 },
      },
      orderBy: { id: "asc" },
      take: 12,
    });
    colorFamily = fam.map((f) => ({
      id: f.id,
      slug: f.slug,
      colorName: f.colorName,
      colorImage: f.colorImage,
      warmImages: [
        ...f.images.map((i) => i.url),
        ...f.variants.map((v) => v.image!).filter(Boolean),
      ].slice(0, 4),
    }));
  }

  await db.product.update({ where: { id: p.id }, data: { views: { increment: 1 } } }).catch(() => {});

  const s = await getSettings();
  const cfg = publicSettings(s);
  const pol = readPolicy(s);
  const cats = await getCategories();
  /* `images` is capped at 6 (same as the /products grid): the card draws its segmented photo
     progress bar and drag gallery, so the rail needs the whole photo list, not just the cover. */
  const relSelect = { id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, badge: true, isNew: true, isBestSeller: true, categoryId: true, preorder: true, images: { select: { url: true, alt: true }, orderBy: { position: "asc" }, take: 6 }, variants: { select: { size: true, stock: true } } } as const;
  const sizesOf = (r: typeof related[number]) => Array.from(new Set((r.variants || []).filter((v) => (r.preorder ? !!v.size : v.stock > 0 && v.size)).map((v) => v.size!))).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return 0;
  });
  const related = await db.product.findMany({
    where: { status: "ACTIVE", categoryId: p.categoryId, id: { not: p.id } },
    select: relSelect, take: 40,
  });
  if (related.length < 4) {
    const extra = await db.product.findMany({ where: { status: "ACTIVE", id: { notIn: [p.id, ...related.map((r) => r.id)] } }, select: relSelect, take: 40 - related.length });
    related.push(...extra);
  }
  const avgRating = p.reviews.length ? p.reviews.reduce((a, r) => a + r.rating, 0) / p.reviews.length : 0;
  const variantStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
  const totalStock = Math.max(p.stock, variantStock);

  // JSON-LD (schema.org Product) → price/stock/review stars in Google results.
  // Shape follows Google's Merchant listing spec (checked against
  // developers.google.com/search/docs/appearance/structured-data/merchant-listing, updated
  // 2026-09-08). Three things in here used to be invisible to Google:
  //   · `shippingDetails` / `hasMerchantReturnPolicy` were sitting on Product. Google reads them
  //     from the OFFER — at Product level they are ignored, so the shipping and free-returns
  //     annotations never had anything to read.
  //   · the strikethrough price used `PriceSpecification.previousPrice`, which is not a
  //     schema.org property; the supported form is a UnitPriceSpecification carrying
  //     `priceType: https://schema.org/StrikethroughPrice`.
  //   · `shippingRate` was a `ShippingRateSettings` with a `label`. It must be a
  //     MonetaryAmount with a numeric `value` + `currency`, and it must carry the real courier
  //     charge, or Google treats the whole shipping block as unusable.
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");
  const absImg = (u?: string) => (u ? (u.startsWith("http") ? u : siteBase + u) : undefined);

  /* The admin types delivery windows as free text ("1-2 days"), Google wants min/max day counts.
     No number in the string → the widest sensible window; never emit NaN. */
  const dayRange = (raw?: unknown): [number, number] => {
    const m = String(raw || "").match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/i);
    if (m) return [Number(m[1]), Number(m[2])];
    const one = String(raw || "").match(/(\d+)/);
    return one ? [Number(one[1]), Number(one[1])] : [1, 3];
  };
  const deliveryTime = (est: unknown) => {
    const [min, max] = dayRange(est);
    return {
      "@type": "ShippingDeliveryTime",
      // handlingTime = our own packing time, transitTime = the courier's, so the two never
      // get conflated with whatever the estimate string happens to say
      handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" },
    };
  };
  /* A rate we can actually state. Null (field never configured / not a number) → that
     destination is left out entirely rather than advertising a shipping price we don't know —
     an invented "৳0" would read as free delivery country-wide. */
  const money = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n >= 0
      ? { "@type": "MonetaryAmount", value: String(Math.round(n)), currency: "BDT" }
      : null;
  };
  /* Two rates exist (inside Dhaka vs everywhere else). Google takes both as separate
     configurations and the more specific one — the Dhaka region — wins for Dhaka addresses.
     The free-over-threshold promise can't be expressed here: shippingRate has no subtotal
     condition, so the cart and PDP totals blocks remain the only place that says it. */
  const rateInside = money(s.shipping?.insideDhaka);
  const rateOutside = money(s.shipping?.outsideDhaka);
  const shippingDetails = [
    ...(rateInside ? [{
      "@type": "OfferShippingDetails",
      shippingRate: rateInside,
      shippingDestination: [{ "@type": "DefinedRegion", addressCountry: "BD", addressRegion: ["Dhaka"] }],
      deliveryTime: deliveryTime(s.shipping?.estimateInside),
    }] : []),
    ...(rateOutside ? [{
      "@type": "OfferShippingDetails",
      shippingRate: rateOutside,
      shippingDestination: [{ "@type": "DefinedRegion", addressCountry: "BD" }],
      deliveryTime: deliveryTime(s.shipping?.estimateOutside),
    }] : []),
  ];
  const onSale = !!(p.comparePrice && p.comparePrice > p.price);
  const saleEnd = p.saleEnds && p.saleEnds.getTime() > Date.now() ? p.saleEnds : null;
  // Google's sale-duration rule: when `price` on the Offer is the discounted price, the window
  // goes on the Offer itself (`validThrough` / `priceValidUntil`) — not on the priceSpecification,
  // where `priceValidUntil` doesn't apply at all. A live flash sale therefore sets the expiry;
  // everything else keeps the rolling 60-day window.
  const priceValidUntil = (saleEnd || new Date(Date.now() + 1000 * 60 * 60 * 24 * 60)).toISOString().slice(0, 10);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    // clean(): the raw DB string has trailing whitespace and newlines, which show up
    // verbatim in Google's snippet and in the JSON-LD preview tool
    description: clean(p.shortDesc || (p.description ? p.description.slice(0, 300) : "")) || clean(p.title),
    // every image in the gallery, in the order the page shows them — Google's merchant listing
    // recommendation is multiple images (it prefers having 1:1 and 4:3 crops to choose from)
    image: (p.images || []).map((i) => absImg(i.url)).filter(Boolean).slice(0, 8),
    sku: p.sku || undefined,
    url: siteBase + "/products/" + p.slug,
    brand: { "@type": "Brand", name: s.store?.name || "TRENDING'S" },
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: String(p.price),
      itemCondition: "https://schema.org/NewCondition",
      availability: p.preorder
        ? "https://schema.org/PreOrder"
        : totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: siteBase + "/products/" + p.slug,
      priceValidUntil,
      // sale price: the Offer's `price` above is the discounted one, so the struck-through
      // original is declared as the strikethrough price type (Google supports no other value)
      ...(onSale ? {
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          priceType: "https://schema.org/StrikethroughPrice",
          price: String(p.comparePrice),
          priceCurrency: "BDT",
        },
      } : {}),
      ...(p.preorder && p.preorderDate ? { availabilityStarts: new Date(p.preorderDate).toISOString().slice(0, 10) } : {}),
      ...(shippingDetails.length ? { shippingDetails } : {}),
      /* Return terms come from admin → Policies (lib/policy.ts), the same values the /returns
         page prints — Google requires the marked-up policy to be the one the site actually
         shows, and this is the only way the two can't drift apart. `merchantReturnLink` is the
         recommended pointer at that page. */
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "BD",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: pol.returnDays,
        returnMethod: "https://schema.org/ReturnByMail",
        // ReturnFeesCustomerResponsibility (not ReturnShippingFees) is the value for "the buyer
        // arranges and pays the return courier" — the latter would additionally require a
        // returnShippingFeesAmount we have no number for.
        returnFees: pol.freeReturnCourier ? "https://schema.org/FreeReturn" : "https://schema.org/ReturnFeesCustomerResponsibility",
        merchantReturnLink: siteBase + "/returns",
      },
    },
  };
  if (p.sku) jsonLd.sku = p.sku;
  if (avgRating > 0 && p.reviews.length) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: String(Math.round(avgRating * 10) / 10),
      reviewCount: String(p.reviews.length),
      bestRating: "5",
      worstRating: "1",
    };
    /* The individual reviews too: `aggregateRating` produces the stars, `review` is what Google
       can quote as snippet text. These are exactly the reviews rendered in the section further
       down this page — markup for a rating that isn't visible on the page is a policy violation,
       so the array stays tied to that same approved, newest-first list. Capped at 10 only to keep
       the payload small; `reviewCount` above still counts every approved review. */
    jsonLd.review = p.reviews.slice(0, 10).map((r) => ({
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      author: { "@type": "Person", name: clean(r.name) || "Customer" },
      datePublished: new Date(r.createdAt).toISOString().slice(0, 10),
      reviewBody: clean(r.text).slice(0, 1000),
    }));
  }

  const first = p.images?.[0]?.url;
  const pv = (u: string, w: number) => imgSrc(u, w) || u;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {first && (
        <link
          rel="preload"
          as="image"
          /* These three props MUST describe the same candidate set the galleries render, or the
             browser preloads one file and then requests another. They used to drift three ways:
             widths [600,1000,1200] against the galleries' [400,600,800,1000], `45vw` against the
             desktop column's calc(52vw - 120px), and a 900px breakpoint against the galleries'
             899px — so a 390px phone at DPR 3 preloaded w1200 and then displayed w1000, and a
             1440px desktop at DPR 1 preloaded w1000 and displayed w800. Both galleries and this
             preload now read PDP_WIDTHS / PDP_SIZES / PDP_SRC_WIDTH from components/img-src.ts,
             so they can only ever move together. */
          href={pv(first, PDP_SRC_WIDTH)}
          imageSrcSet={PDP_WIDTHS.map((w) => `${pv(first, w)} ${w}w`).join(", ")}
          imageSizes={PDP_SIZES}
          fetchPriority="high"
        />
      )}
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container">
        <div style={{ padding: "22px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
          <Link href="/">Home</Link> / <Link href="/products">Shop</Link> {(p as any).category && String((p as any).category.name || "").trim().toLowerCase() !== String(p.title || "").trim().toLowerCase() && <>/ <Link href={"/products?category=" + (p as any).category.slug}>{(p as any).category.name}</Link></>} / <span style={{ color: "var(--text)" }}>{p.title}</span>
        </div>
        {/* The Delivery row reads the same admin shipping fields the checkout uses (with the same
            fallback strings), so the PDP can never contradict what the buyer pays or waits for. */}
        <ProductPageClient
          policies={{ inside: s.shipping?.estimateInside, outside: s.shipping?.estimateOutside, freeAt: FEATURES.freeDelivery ? s.shipping?.freeShippingThreshold || 0 : 0 }}
          sizeChartImage={p.sizeChartImage || null}
          soldCount={FEATURES.soldCount ? (p.soldCount ?? null) : null}
          saleEnds={p.saleEnds ? p.saleEnds.toISOString() : null}
          preorder={!!p.preorder}
          preorderDate={p.preorderDate ? p.preorderDate.toISOString() : null}
          soldMode={p.soldMode || "fixed"}
          product={{
            id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
            shortDesc: p.shortDesc, description: p.description, sku: p.sku, stock: p.stock, lowStock: p.lowStock,
            // gallery = product images + any linked variant (color) images appended
            images: [
              ...p.images.map((i) => ({ url: i.url, alt: i.alt || p.title })),
              ...(FEATURES.colorGroups ? Array.from(new Set(p.variants.filter((v) => v.stock > 0 && v.image && !p.images.some((i) => i.url === v.image)).map((v) => v.image!))) : [])
                .filter(Boolean)
                .map((u) => ({ url: u, alt: `${p.title}` })),
            ],
            variants: p.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, price: v.price, image: FEATURES.colorGroups ? (v.image || null) : null })),
            categoryName: p.category?.name,
            categorySlug: p.category?.slug,
            colorName: p.colorName,
            colorImage: p.colorImage,
          }}
          /* Sanitised HERE, on the server, at the trust boundary — not in the client
             component. Category.sizeChart is admin-authored HTML that is injected with
             dangerouslySetInnerHTML, so whatever leaves this prop is what a shopper's
             browser executes. lib/sanitize rebuilds the markup from an allow-list of
             tags and attributes instead of pattern-matching attack strings: a blocklist
             regex has to be right about every payload ever invented, an allow-list only
             has to be right about the six tags a size chart uses. */
          sizeChartHtml={sizeChartHtml(p.category?.sizeChart)}
          colorFamily={colorFamily}
        />
        {/* Reviews — the first block past the fold on a PDP, and the one surface that had no
            entrance at all. `.sdr` drives it from a CSS view() timeline (see globals.css §J). */}
        <section className="reviews sdr">
          <div className="section-head">
            <div><div className="eyebrow">Customer feedback</div><h2>Reviews ({p.reviews.length})</h2></div>
            {avgRating > 0 && <div style={{ fontSize: 15 }}>{"★".repeat(Math.round(avgRating))}<span style={{ color: "var(--muted)" }}> {avgRating.toFixed(1)} / 5</span></div>}
          </div>
          {p.reviews.length === 0 && <p style={{ color: "var(--muted)" }}>No reviews yet — be the first to review this product.</p>}
          {p.reviews.length > 1 && (
            <div className="reviews-hint">Swipe for all {p.reviews.length} reviews <span aria-hidden="true">→</span></div>
          )}
          {/* one track wrapper so phones can swipe the reviews sideways; desktop keeps the plain
              vertical stack (the wrapper is inert there — no .reviews .review descendant selectors exist) */}
          <div className="reviews-track">
          {p.reviews.map((r) => (
            <div className="review" key={r.id}>
              <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              {r.verified && <span className="verified">Verified purchase</span>}
              <div className="who">{r.name} · {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
              <p>{r.text}</p>
              {(() => {
                let photos: string[] = [];
                try { photos = JSON.parse((r as any).photos || "[]"); } catch {}
                if (!photos.length) return null;
                return (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {photos.map((u) => (
                      <img key={u} src={u} alt={`Photo from ${r.name}`} loading="lazy" decoding="async" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
                    ))}
                  </div>
                );
              })()}
            </div>
          ))}
          </div>
          <ProductPageReviewForm productId={p.id} />
        </section>

        {/* Related */}
        <section className="section" style={{ paddingTop: 20 }}>
          <div className="section-head"><div><div className="eyebrow">Keep browsing</div><h2>You may also like</h2></div></div>
          {/* MOBILE: 2×2 swipeable carousel. This markup used to be rendered inline — with
              `touch-action: pan-y` on `.rel-scroll` (which tells the browser NOT to pan it
              horizontally) and no gesture handler behind it, so a thumb swipe on a phone moved
              nothing at all. It is the shared rail now: same classes, same 2×2 pages, same bare
              dots, but `components/related-carousel.tsx` drives `scrollLeft` with the swipe
              machine and keeps the dots in sync with the page. */}
          <RelatedCarousel
            items={related.slice(0, 40).map((r) => ({
              id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice,
              image: r.images?.[0]?.url, images: r.images, stock: r.stock,
              badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller, preorder: r.preorder, sizes: sizesOf(r),
            }))}
            dots
          />

          {/* DESKTOP: compact 4-col grid (normal product card size) */}
          <div className="grid grid-4 desktop-only">
            {related.map((r) => (
              <ProductCard key={r.id} p={{ id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice, image: r.images?.[0]?.url, images: (r.images || []).map((i) => i.url), stock: r.stock, badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller, preorder: r.preorder, sizes: sizesOf(r) }} />
            ))}
          </div>
        </section>
      </div>
      <RecentlyViewedServer currentId={p.id} />

      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}

