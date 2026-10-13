import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { clean } from "@/lib/search";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard, imgSrc } from "@/components/parts";
import { ComboOffer } from "@/components/combo-offer";
import { loadActivePromotion } from "@/lib/promotions/repository";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Combo Offers — Free Gift Tiers",
  description: "Build your combo and unlock complimentary pieces with 3, 4, or 6 items.",
};

export default async function ComboPage() {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const [s, cats, promo, products] = await Promise.all([
    getSettings(),
    getCategories(),
    loadActivePromotion().catch(() => null),
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ featured: "desc" }, { position: "asc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        slug: true,
        price: true,
        comparePrice: true,
        stock: true,
        badge: true,
        isNew: true,
        isBestSeller: true,
        saleEnds: true,
        preorder: true,
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { position: "asc" }, take: 6 },
        variants: {
          select: { id: true, size: true, color: true, stock: true, price: true },
          orderBy: { id: "asc" },
        },
      },
    }),
  ]);

  const cfg = publicSettings(s);

  const tiers = (promo?.tiers && promo.tiers.length > 0)
    ? promo.tiers.map((t: any, idx: number) => ({
        no: String(idx + 1).padStart(2, "0"),
        req: t.requiredQuantity,
        label: t.label || `Buy ${t.requiredQuantity}+ Items`,
        slots: (t.slots || []).map((sl: any) => ({
          key: sl.key,
          label: sl.label,
          poolKey: sl.poolKey,
          quantity: sl.quantity || 1,
        })),
      }))
    : [
        {
          no: "01",
          req: 3,
          label: "Buy 3 — 1 Free Shirt / T-Shirt",
          slots: [{ key: "shirt", label: "1 Free Shirt or T-Shirt", poolKey: "shirt_or_tee", quantity: 1 }],
        },
        {
          no: "02",
          req: 4,
          label: "Buy 4 — 1 Free Baggy Denim (instead of shirt)",
          slots: [{ key: "denim", label: "1 Free Baggy Denim / Bottom", poolKey: "baggy_denim", quantity: 1 }],
        },
        {
          no: "03",
          req: 6,
          label: "Buy 6 — 2 Free Gifts (Denim + Shirt/Tee)",
          slots: [
            { key: "denim6", label: "1 Free Baggy Denim", poolKey: "baggy_denim", quantity: 1 },
            { key: "shirt6", label: "1 Free Shirt or T-Shirt", poolKey: "shirt_or_tee", quantity: 1 },
          ],
        },
      ];

  const pools = (promo?.giftPools || []).map((pool: any) => {
    const seen = new Set<string>();
    const uniqueProducts: {
      productId: string;
      name: string;
      slug: string;
      image: string | null;
      price: number;
    }[] = [];
    for (const c of pool.candidates || []) {
      if (!c.selectable) continue;
      if (seen.has(String(c.productId))) continue;
      seen.add(String(c.productId));
      uniqueProducts.push({
        productId: String(c.productId),
        name: c.productName,
        slug: c.productSlug,
        image: c.imageUrl || null,
        price: Math.round((c.priceMinor || 0) / 100),
      });
    }
    return {
      key: pool.key,
      label: pool.label,
      description: pool.description,
      items: uniqueProducts,
    };
  });

  const mappedProducts = products.map((p) => ({
    id: p.id,
    title: clean(p.title),
    slug: p.slug,
    price: p.price,
    comparePrice: p.comparePrice,
    image: p.images?.[0]?.url,
    images: (p.images || []).map((im) => im.url),
    categoryName: p.category?.name,
    stock: Math.max(p.stock, p.variants.reduce((acc, v) => acc + v.stock, 0)),
    isNew: p.isNew,
    isBestSeller: p.isBestSeller,
    badge: p.badge,
    preorder: !!p.preorder,
    saleEnds: (p as any).saleEnds ? new Date((p as any).saleEnds).toISOString() : null,
    colors: Array.from(new Set(p.variants.filter((v) => (p.preorder || v.stock > 0) && v.color).map((v) => v.color!))),
    sizes: [...new Set(p.variants.filter((v) => (p.preorder || v.stock > 0) && v.size).map((v) => v.size!))].sort(),
    qa: (() => {
      const pick = p.variants.find((v) => v.stock > 0) || p.variants[0];
      if (!pick) return null;
      const sizes = new Set(p.variants.map((v) => v.size).filter(Boolean));
      const cols = new Set(p.variants.map((v) => v.color).filter(Boolean));
      if (sizes.size > 1 || cols.size > 1) return null;
      return {
        variantId: pick.id,
        price: pick.price || p.price,
        stock: p.preorder ? 99 : pick.stock,
        size: pick.size || undefined,
        color: pick.color || undefined,
      };
    })(),
  }));

  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header
        storeName={cfg.store?.name || "TRENDING'S"}
        categories={cats.map((c) => ({ name: c.name, slug: c.slug }))}
      />

      <main className="combo-page">
        {/* Classic Editorial Combo Hero */}
        <section className="combo-hero">
          <div className="container combo-hero-inner">
            <div className="combo-eyebrow">
              <span className="combo-eyebrow-rule" aria-hidden="true" />
              <span>Complimentary Gift Tiers · {cfg.store?.name || "TRENDING'S"}</span>
            </div>
            <h1 className="combo-title">
              {promo?.name || "Curate Your Wardrobe, Unlock Complimentary Pieces."}
            </h1>
            <p className="combo-sub">
              {promo?.description ||
                "Add any 3 pieces to unlock a complimentary Shirt or T-Shirt, 4 pieces for a complimentary Denim/Bottom, or 6 pieces to receive both gifts at ৳0."}
            </p>
            <div className="combo-hero-actions">
              <a className="btn" href="#combo-shop">
                Build Your Combo
              </a>
              <Link className="btn btn-outline" href="/cart">
                Go to Cart &amp; Claim Gift
              </Link>
            </div>
          </div>
        </section>

        <div className="container combo-body">
          {/* Live Cart Progress & Interactive Gift Picker */}
          <section className="combo-live-box" aria-label="Your Combo Progress">
            <div className="combo-live-head">
              <div>
                <div className="combo-sec-kicker">Live Cart Status</div>
                <h2 className="combo-sec-title">Your Combo Unlock Progress</h2>
              </div>
              <Link href="/cart" className="sh-link">
                Open Full Cart <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ComboOffer />
          </section>

          {/* 3-Step Tier Ladder */}
          <section className="combo-section">
            <div className="section-head2">
              <div>
                <div className="sh-eyebrow">
                  <span className="sh-no">01</span>How It Works
                </div>
                <h2>Three Reward Tiers, Automatically Unlocked</h2>
              </div>
            </div>

            <div className="combo-tier-grid">
              {tiers.map((t, idx) => (
                <article className="combo-tier-card" key={t.no + idx}>
                  <div className="combo-tier-top">
                    <span className="combo-tier-step">Tier {t.no}</span>
                    <span className="combo-tier-badge">৳0 Complimentary</span>
                  </div>
                  <div className="combo-tier-req">Buy {t.req}+ Pieces</div>
                  <h3 className="combo-tier-name">{t.label.replace(/^Buy \d+\s*—\s*/i, "")}</h3>
                  <ul className="combo-tier-list">
                    {t.slots.map((sl: any) => (
                      <li key={sl.key}>
                        <span className="combo-tier-check" aria-hidden="true">✓</span>
                        <span>{sl.label}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="combo-tier-note">
                    {idx === 0 && "Unlocks automatically as soon as 3 eligible items are in your bag."}
                    {idx === 1 && "Upgrades your reward to the higher-tier pool when you reach 4 items."}
                    {idx >= 2 && "Unlocks both complimentary gift slots together at 6+ items."}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Eligible Free Gift Pools Preview */}
          {pools.length > 0 && (
            <section className="combo-section">
              <div className="section-head2">
                <div>
                  <div className="sh-eyebrow">
                    <span className="sh-no">02</span>Complimentary Gift Pools
                  </div>
                  <h2>Pieces You Can Claim for Free</h2>
                </div>
              </div>

              <div className="combo-pools-wrap">
                {pools.map((pool) => (
                  <div className="combo-pool-block" key={pool.key}>
                    <div className="combo-pool-head">
                      <div>
                        <h3>{pool.label}</h3>
                        {pool.description && <p>{pool.description}</p>}
                      </div>
                      <span className="combo-pool-count">{pool.items.length} eligible styles</span>
                    </div>
                    {pool.items.length > 0 ? (
                      <div className="combo-pool-grid">
                        {pool.items.slice(0, 6).map((item) => (
                          <Link
                            href={"/products/" + item.slug}
                            key={item.productId}
                            className="combo-pool-item"
                          >
                            <div className="combo-pool-thumb">
                              {item.image ? (
                                <img
                                  src={imgSrc(item.image, 600)}
                                  alt={item.name}
                                  loading="lazy"
                                />
                              ) : null}
                              <span className="combo-pool-free-tag">FREE GIFT</span>
                            </div>
                            <div className="combo-pool-meta">
                              <div className="combo-pool-item-title">{item.name}</div>
                              <div className="combo-pool-item-price">
                                <s>৳{item.price.toLocaleString("en-IN")}</s>{" "}
                                <b>৳0 with Combo</b>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Shop All Eligible Products */}
          <section className="combo-section" id="combo-shop">
            <div className="section-head2">
              <div>
                <div className="sh-eyebrow">
                  <span className="sh-no">03</span>Build Your Bag
                </div>
                <h2>Add Any {tiers[0]?.req || 3}+ Pieces to Unlock Your Gift</h2>
              </div>
              <Link className="sh-link" href="/products">
                Filter &amp; Sort <span aria-hidden="true">→</span>
              </Link>
            </div>

            <div className="grid grid-4 shop-grid">
              {mappedProducts.map((p, idx) => (
                <ProductCard key={p.id} p={p} rd={idx % 4} />
              ))}
            </div>
          </section>
        </div>
      </main>

      <Footer cfg={cfg} />
    </>
  );
}
