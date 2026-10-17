"use client";
import PdpWaitlist from "@/components/pdp-waitlist";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, trackEvent, toast } from "@/components/store";
import { ComboPdpHint } from "@/components/combo-offer";
import { imgSrc, imgSrcSet, PDP_WIDTHS, PDP_SIZES, PDP_SRC_WIDTH, THUMB_WIDTHS } from "@/components/parts";
import { warmImage, warmWhenIdle } from "@/components/img-warm";
import { trackRecentlyViewed } from "@/components/recently-viewed";
import MobileGallery from "@/components/mobile-gallery";
import CarouselDots from "@/components/carousel-dots";
// LiveWatching import removed — live views OFF per user request
import SoldCount from "@/components/sold-count";
import { FEATURES } from "@/lib/features";
import { normAlpha, ALPHA_ORDER } from "@/lib/size-rec";

type V = { id: number; size: string | null; color: string | null; stock: number; price: number | null; image?: string | null };
type P = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  shortDesc?: string | null; description?: string | null; sku?: string | null;
  stock: number; lowStock: number; images: { url: string; alt: string }[];
  variants: V[]; categoryName?: string; categorySlug?: string; colorName?: string | null; colorImage?: string | null;
};


type ColorFamilyItem = { id: number; slug: string; colorName: string | null; colorImage: string | null; warmImages?: string[] };

function Countdown({ ends }: { ends: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const end = new Date(ends).getTime();
    const tick = () => {
      const d = end - Date.now();
      setLeft(d > 0 ? d : 0);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [ends]);
  if (left == null || left <= 0) return null;
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const unit = (v: number, l: string) => (
    <span style={{ textAlign: "center" }}>
      <b style={{ display: "block", fontSize: 16, fontVariantNumeric: "tabular-nums", minWidth: 30 }}>{pad(v)}</b>
      <i style={{ fontStyle: "normal", fontSize: 9, letterSpacing: ".1em", color: "var(--muted)" }}>{l}</i>
    </span>
  );
  return (
    <div className="flash-box">
      <span className="flash-box-label">Sale ends</span>
      <span style={{ display: "inline-flex", gap: 6 }}>
        {unit(h, "HRS")}{unit(m, "MIN")}{unit(s, "SEC")}
      </span>
    </div>
  );
}

export default function ProductPageClient({ product, sizeChartHtml, sizeChartImage, soldCount, saleEnds, preorder = false, preorderDate = null, soldMode = "fixed", colorFamily = [], policies }: { product: P; sizeChartHtml: string | null; sizeChartImage: string | null; soldCount?: number | null; saleEnds?: string | null; preorder?: boolean; preorderDate?: string | null; soldMode?: string | null; colorFamily?: ColorFamilyItem[]; policies?: { inside?: string; outside?: string; freeAt?: number; codLabel?: string } }) {
  const { add } = useCart();
  const router = useRouter();
  const N = product.images.length;

  // ---------- gallery state ----------
  const [img, setImg] = useState(0);
  /* Desktop hero decode state. The mobile gallery already had a per-slide skeleton; the
     desktop main image had nothing — it sat on a flat #eee9e2 box until the bitmap arrived,
     which on a slow mobile connection reads as a broken image rather than a loading one.
     Reset on every slide change so each new photo shimmers until it is actually painted. */
  const [heroLoaded, setHeroLoaded] = useState(false);
  /* Depends on `img` alone, not on `mainSrc`: mainSrc is derived from `img` and is declared
     further down (line ~300), so referencing it here would be a use-before-declaration.
     Every slide change already implies a new source, so the reset still fires correctly. */
  useEffect(() => { setHeroLoaded(false); }, [img]);
  const [lightbox, setLightbox] = useState(false);
  const [lbIdx, setLbIdx] = useState(0);
  const [lbZoom, setLbZoom] = useState(false);
  const [hoverZoom, setHoverZoom] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);


  /* ---------- mobile swipe-to-slide on main gallery image ----------
     Finger tracks 1:1 (translate3d), axis-locked so vertical scroll works.
     Release: momentum decides slide to next/prev; short drag springs back.
     Slide-out → swap → slide-in from opposite side (260ms, premium easing). */
  const mainRef = useRef<HTMLDivElement>(null);
  const swipe = useRef({ x0: 0, y0: 0, dx: 0, locked: false as false | "x" | "y", t0: 0 });

  const onMainTouchStart = (e: React.TouchEvent) => {
    if (N < 2) return;
    const t = e.touches[0];
    swipe.current = { x0: t.clientX, y0: t.clientY, dx: 0, locked: false, t0: Date.now() };
  };

  const onMainTouchMove = (e: React.TouchEvent) => {
    const sw = swipe.current;
    if (!sw.x0 || N < 2) return;
    const t = e.touches[0];
    const dx = t.clientX - sw.x0;
    const dy = t.clientY - sw.y0;
    if (!sw.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (sw.locked === "x") {
        const el = mainRef.current;
        if (el) el.style.transition = "none";
      }
    }
    if (sw.locked !== "x") return;
    sw.dx = dx;
    // rubber-band at first/last
    let off = dx;
    if ((img === 0 && dx > 0) || (img === N - 1 && dx < 0)) off = dx * 0.35;
    const el = mainRef.current;
    if (el) el.style.transform = `translate3d(${off}px,0,0)`;
  };

  const onMainTouchEnd = () => {
    const sw = swipe.current;
    if (!sw.x0) return;
    const el = mainRef.current;
    const dt = Math.max(1, Date.now() - sw.t0);
    const vel = sw.dx / dt;
    let dir = 0;
    if (sw.locked === "x") {
      if (sw.dx < -55 || vel < -0.5) dir = 1;        // next
      else if (sw.dx > 55 || vel > 0.5) dir = -1;    // prev
    }
    swipe.current = { x0: 0, y0: 0, dx: 0, locked: false, t0: 0 };
    if (dir !== 0 && img + dir >= 0 && img + dir < N) {
      const target = img + dir;
      // preload target before slide → no white flash
      warmImage(product.images[target]?.url);
      setImg(target);
      // slide container from edge into place (280ms, no opacity change = no flash)
      if (el) {
        el.style.transition = "none";
        el.style.transform = `translate3d(${dir * 40}%,0,0)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!mainRef.current) return;
            mainRef.current.style.transition = "transform 300ms cubic-bezier(.22,.61,.36,1)";
            mainRef.current.style.transform = "translate3d(0,0,0)";
          });
        });
      }
    } else if (el && sw.locked === "x") {
      // spring back to current
      el.style.transition = "transform 260ms cubic-bezier(.22,.61,.36,1)";
      el.style.transform = "translate3d(0,0,0)";
    }
  };

  /* Instant swap, no fade-gate: the <img> element keeps displaying the previous
     bitmap while the new src downloads (browser-native behaviour), so tapping a
     thumbnail NEVER shows a blank box — the new photo appears the moment it's
     decoded. warmImage() races the exact variant into cache ahead of the swap. */
  const goTo = (i: number) => {
    const n = ((i % N) + N) % N;
    if (n === img) return;
    warmImage(product.images[n]?.url);
    setImg(n);
  };
  const next = () => goTo(img + 1);
  const prev = () => goTo(img - 1);

  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent, isLb = false) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      if (isLb) setLbIdx(((lbIdx + (dx < 0 ? 1 : -1)) % N + N) % N); else (dx < 0 ? next : prev)();
    }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!lightbox) return;
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") setLbIdx(((lbIdx + 1) % N + N) % N);
      if (e.key === "ArrowLeft") setLbIdx(((lbIdx - 1) % N + N) % N);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [lightbox, lbIdx, N]);

  // ---------- variant / buy state (existing logic) ----------
  const initialVariant = product.variants.find((v) => preorder || (product.stock > 0 && v.stock > 0)) || product.variants[0];
  const [size, setSize] = useState<string | null>(initialVariant?.size || null);
  const [color, setColor] = useState<string | null>(initialVariant?.color || null);
  const [qty, setQty] = useState(1);
  const [chart, setChart] = useState(false);
  const [buying, setBuying] = useState(false);
  const [adding, setAdding] = useState(false);

  // size sequence maintained: numbers ascending first (28, 30, …40), then letter sizes (S→XL)
  const sizes = Array.from(new Set(product.variants.map((v) => v.size).filter(Boolean))) as string[];
  const sizeOrder = ALPHA_ORDER;
  sizes.sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    if (!Number.isNaN(na)) return -1;
    if (!Number.isNaN(nb)) return 1;
    return sizeOrder.indexOf(normAlpha(a)) - sizeOrder.indexOf(normAlpha(b));
  });
  const colors = Array.from(new Set(product.variants.map((v) => v.color).filter(Boolean))) as string[];

  // Per-size availability for the selected color; out-of-stock sizes stay disabled.
  const sizeStock: Record<string, number> = {};
  for (const s of sizes) {
    const matching = product.variants.filter((v) => v.size === s && (!color || v.color === color));
    sizeStock[s] = preorder ? (matching.length ? 99 : 0) : Math.min(product.stock, Math.max(0, ...matching.map((v) => v.stock)));
  }

  /* Linked color variants: if the selected color has a linked image, jump the
     gallery to it (prepended at position 0 of the gallery data below). */
  const colorImageMap = (() => {
    const m = new Map<string, string>();
    for (const v of product.variants) {
      if (v.color && v.image && !m.has(v.color.toLowerCase())) m.set(v.color.toLowerCase(), v.image);
    }
    return m;
  })();
  const showColorImage = (c: string) => {
    const url = colorImageMap.get(c.toLowerCase());
    if (url) {
      const i = product.images.findIndex((im) => im.url === url);
      if (i >= 0) { warmImage(product.images[i]?.url); setImg(i); }
    }
  };

  const matchesSelection = (v: V) => (!size || v.size === size) && (!color || v.color === color);
  const activeVariant = product.variants.find((v) => matchesSelection(v) && (preorder || v.stock > 0)) || product.variants.find(matchesSelection) || null;
  const avail = activeVariant ? Math.min(activeVariant.stock, product.stock) : product.variants.length ? 0 : product.stock;
  const price = activeVariant?.price ?? product.price;
  const off = product.comparePrice && product.comparePrice > price ? Math.round((1 - price / product.comparePrice) * 100) : 0;
  const preDateStr = preorderDate ? new Date(preorderDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "soon";

  useEffect(() => {
    window.scrollTo(0, 0);
    trackRecentlyViewed({ id: product.id, slug: product.slug, title: product.title, image: product.images[0]?.url, price: product.price });
  }, [product.id]);

  // Idle-warm the rest of the gallery ~1.5s after load → swiping photos is instant
  useEffect(() => {
    const t = setTimeout(() => { for (const im of product.images) warmImage(im.url, { idle: true }); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  /* Linked color family: idle-warm each sibling color's images + prefetch its
     PDP route, staggered (~0.8s apart, after the page settles). Clicking a
     color thumbnail then opens an already-cached page instantly. */
  useEffect(() => {
    if (!FEATURES.colorGroups || !colorFamily.length) return;
    const timers: any[] = [];
    colorFamily.forEach((c, i) => {
      timers.push(setTimeout(() => {
        try { router.prefetch("/products/" + c.slug); } catch {}
        for (const im of c.warmImages || []) warmWhenIdle(im, 100);
        warmWhenIdle(c.colorImage, 100);
      }, 2500 + i * 800));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorFamily.length]);

  useEffect(() => {
    trackEvent("ViewContent", {
      value: price, currency: "BDT", content_name: product.title,
      content_ids: [String(product.id)], content_type: "product",
      contents: [{ id: String(product.id), quantity: 1, item_price: price }],
    }, { eventId: "vc_" + product.id + "_" + Date.now().toString(36) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const line = () => ({
    productId: product.id, variantId: activeVariant?.id, slug: product.slug, title: product.title,
    image: product.images[0]?.url, price, qty, size: size || undefined, color: color || undefined, stock: avail || 99,
    preorder: !!preorder,
  });
  const addLine = () => {
    if (adding || buying) return; // no duplicate adds
    setAdding(true);
    add(line(), qty);
    toast("Added to cart ✓");
    setTimeout(() => setAdding(false), 450); // brief confirmation state
  };
  // Mobile swipe gallery — enabled on ALL deployments (Vercel + VPS), 2026-09-10

  const buyNow = () => {
    if (buying || adding) return;
    setBuying(true);
    add(line(), qty);
    router.push("/checkout");
  };

  const mainSrc: string | undefined = (product.images[img] || product.images[0])?.url;

  return (
    <>
      <div className="pdp">
        {/* ---------------- GALLERY ---------------- */}
        <div className="pdp-gallery">
          {/* MOBILE: swipeable gallery — all deployments (Vercel + VPS) */}
          <div className="pdp-gallery-mobile mobile-only">
            <MobileGallery images={product.images} title={product.title} active={img} onIndexChange={setImg} />
            {avail <= 0 && !preorder && <div className="soldout-overlay"><span>Sold Out</span></div>}
          </div>

          {/* DESKTOP: classic gallery — main image + hover zoom + thumbnail rail */}
          <div className="pdp-gallery-desktop hide-on-mobile">
          <div
            ref={mainRef}
            className={"pdp-main-img" + (N <= 1 ? " single" : "")}
            onTouchStart={onMainTouchStart}
            onTouchMove={onMainTouchMove}
            onTouchEnd={onMainTouchEnd}
            onTouchCancel={onMainTouchEnd}
          >
            {mainSrc && !heroLoaded && <div className="sk sk-fill" aria-hidden="true" />}
            {mainSrc ? (
              <img
                src={imgSrc(mainSrc, PDP_SRC_WIDTH) || mainSrc}
                srcSet={imgSrcSet(mainSrc, PDP_WIDTHS)}
                sizes={PDP_SIZES}
                alt={product.images[img]?.alt || product.title}
                className={"pdp-img" + (hoverZoom ? " hz" : "")}
                fetchPriority="high"
                onLoad={() => setHeroLoaded(true)}
                /* A failed photo must not leave the shimmer running forever: mark it settled
                   so the skeleton unmounts and the box falls back to its plain background. */
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; setHeroLoaded(true); }}
                style={{ position: "relative", zIndex: 1, ...(hoverZoom ? { transformOrigin: "50% 50%" } : null) }}
                onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) setHoverZoom(true); }}
                onMouseLeave={() => { setHoverZoom(false); }}
                onMouseMove={(e) => {
                  // write transform-origin straight to the DOM node — no re-render on every mousemove
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
                }}
              />
            ) : (
              <div className="noimg noimg-desktop"><div className="noimg-in"><span className="noimg-mark" aria-hidden>S</span><span>No photo yet</span></div></div>
            )}
            {/* zoom — top right corner */}
            <button className="gal-zoom" title="Zoom" aria-label="Zoom image"
              onClick={() => { setLbIdx(img); setLbZoom(false); setLightbox(true); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
            </button>
            {avail <= 0 && !preorder && <div className="soldout-overlay"><span>Sold Out</span></div>}
          </div>

          {/* One clickable dot per photo, kept below the main image. */}
          {N > 1 && (
            <CarouselDots
              count={N}
              activeIndex={img}
              className="gal-progress"
              onSelect={goTo}
            />
          )}

          {N > 1 && (
            <div className="thumbs">
              {product.images.map((im, i) => (
                <button key={i} className={i === img ? "active" : ""} onClick={() => goTo(i)} aria-label={"Image " + (i + 1)}>
                  <img src={imgSrc(im.url, 200) || im.url} srcSet={imgSrcSet(im.url, THUMB_WIDTHS)} sizes="72px"
                       alt={im.alt} loading="lazy" decoding="async" width={72} height={96} />
                </button>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* ---------------- INFO ---------------- */}
        <div className="pdp-info">
          <h1>{product.title}</h1>
          {preorder && (
            <div className="pdp-preorder">
              <span className="pdp-preorder-badge">Pre-order</span>
              <span>Expected delivery {preDateStr}</span>
            </div>
          )}
          {saleEnds && product.comparePrice && product.comparePrice > price && new Date(saleEnds).getTime() > Date.now() && (
            <Countdown ends={saleEnds} />
          )}
          <div className="pdp-price">
            <b>৳{price.toLocaleString("en-IN")}</b>
            {product.comparePrice && product.comparePrice > price && (<><s>৳{product.comparePrice.toLocaleString("en-IN")}</s><span className="off">{off}% OFF</span></>)}
          </div>
          {/* LiveWatching OFF per user request (component dormant in components/live-watching.tsx) */}
          <SoldCount productId={product.id} soldCount={soldCount} soldMode={soldMode} />
          {product.shortDesc && <p className="pdp-desc">{product.shortDesc}</p>}

          {/* ---- COLOR FAMILY selector (linked products, real navigation) ---- */}
          {FEATURES.colorGroups && colorFamily.length > 0 && (
            <div className="color-family">
              <div className="opt-label">Color {product.colorName ? <span style={{ textTransform: "none", letterSpacing: 0 }}>— {product.colorName}</span> : null}</div>
              <div className="color-family-row" role="listbox" aria-label="Color">
                <Link
                  href={"/products/" + product.slug}
                  className="color-swatch active"
                  role="option"
                  aria-selected="true"
                  aria-label={`${product.colorName || product.title} (current)`}
                  title={`${product.colorName || product.title} (current)`}
                >
                  {product.colorImage
                    ? <img src={imgSrc(product.colorImage, 200) || product.colorImage} srcSet={imgSrcSet(product.colorImage, THUMB_WIDTHS)} sizes="44px"
                           alt={product.colorName || product.title} width={44} height={44} loading="lazy" decoding="async" />
                    : <span className="color-swatch-fallback" aria-hidden>{(product.colorName || "?").slice(0, 1)}</span>}
                </Link>
                {colorFamily.map((c) => (
                  <Link
                    key={c.id}
                    href={"/products/" + c.slug}
                    onPointerEnter={() => { for (const im of c.warmImages || []) warmImage(im); if (c.colorImage) warmImage(c.colorImage); }}
                    onTouchStart={() => { for (const im of c.warmImages || []) warmImage(im); if (c.colorImage) warmImage(c.colorImage); }}
                    className="color-swatch"
                    role="option"
                    aria-selected="false"
                    aria-label={`${c.colorName || c.slug}`}
                    title={c.colorName || c.slug}
                  >
                    {c.colorImage
                      ? <img src={imgSrc(c.colorImage, 200) || c.colorImage} srcSet={imgSrcSet(c.colorImage, THUMB_WIDTHS)} sizes="44px"
                             alt={c.colorName || c.slug} width={44} height={44} loading="lazy" decoding="async" />
                      : <span className="color-swatch-fallback" aria-hidden>{(c.colorName || "?").slice(0, 1)}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {sizes.length > 0 && (
            <>
              <div className="opt-label">Size {(sizeChartHtml || sizeChartImage) && <button className="sizechart-link" onClick={() => setChart(true)}>📏 Size chart</button>}</div>
              <div className="sizes">
                {sizes.map((s) => {
                  const stock = sizeStock[s] || 0;
                  return (
                    <button key={s} className={"size-btn" + (size === s ? " active" : "")} disabled={stock <= 0 && !preorder}
                      onClick={() => { setSize(s); setQty(1); }}>{s}</button>
                  );
                })}
              </div>
            </>
          )}
          {colors.length > 0 && (
            <>
              <div className="opt-label">Color {color && <span style={{ textTransform: "none", letterSpacing: 0 }}>— {color}</span>}</div>
              <div className="sizes">
                {colors.map((c) => (
                  <button key={c} title={c} aria-label={c} className={"color-dot" + (color === c ? " active" : "")}
                    style={{ background: c.toLowerCase() === "white" || c.toLowerCase() === "off-white" || c.toLowerCase() === "cream" ? "#f4f0e8" : c.toLowerCase() }}
                    onClick={() => { setColor(c); setQty(1); showColorImage(c); }} />
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 10 }}>
            {preorder ? (
              <span className="stock-note">Pre-order — ships by {preDateStr}</span>
            ) : avail > 0 ? (
              <span className="stock-note">{avail <= 5 ? `Only ${avail} left — order soon` : "In stock"}</span>
            ) : <span className="stock-note low">Sold out</span>}
          </div>

          {!preorder && avail <= 0 && (
            <PdpWaitlist productId={product.id} variantId={activeVariant?.id ?? null} title={product.title} />
          )}

          <ComboPdpHint />

          <div className="pdp-actions">
            <div className="pdp-buy-row">
              <div className="qty" role="group" aria-label="Quantity">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity">−</button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty(Math.min(qty + 1, preorder ? 99 : (avail || 1)))} aria-label="Increase quantity">+</button>
              </div>
              <button className="btn pdp-add" disabled={(avail <= 0 && !preorder) || adding} aria-busy={adding || undefined} onClick={addLine}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.6 7.6h11L13.7 18.6a1.7 1.7 0 0 1-1.7 1.5H6.3a1.7 1.7 0 0 1-1.7-1.5z"/><path d="M6.7 7.6V6.1a3.6 3.6 0 0 1 7.2 0v1.5"/><path d="M19.7 2.8v4.4M17.5 5h4.4"/></svg>
                {adding && <span className="spinner" aria-hidden="true" />}<span style={adding ? { marginLeft: 8 } : undefined}>{adding ? "Adding…" : preorder ? "Pre-order" : "Add to cart"}</span>
              </button>
            </div>
            <button className="btn pdp-buy" disabled={(avail <= 0 && !preorder) || buying} aria-busy={buying || undefined} onClick={buyNow}>
              {buying && <span className="spinner" aria-hidden="true" />}<span style={buying ? { marginLeft: 8 } : undefined}>{buying ? "Processing…" : "Buy it now"}</span>
            </button>
          </div>

          <div className="pdp-meta">
            <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>Cash on Delivery available all over Bangladesh</div>
            <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Inside Dhaka 1–2 days · Outside Dhaka 2–4 days</div>
            <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.6 4.2M3 3v5h5"/></svg>7-day easy return &amp; exchange</div>
            {product.sku && <div style={{ fontSize: 12 }}>SKU: {product.sku}</div>}
          </div>
        </div>
      </div>

      {/* ---- expandable rows (the reference: label left, + right, thin rules) ----
          native <details>/<summary> on purpose: no state, no JS round-trip, keyboard + screen-reader
          semantics for free, and — important — the full text ships inside the server HTML, so collapsing
          it visually does not hide it from Google or from the SSR render. */}
      <section className="section" style={{ padding: "10px 0 46px" }}>
        <div className="section-head"><div><div className="eyebrow">The details</div><h2>About this product</h2></div></div>
        <div className="acc">
          {(product.description || product.shortDesc) && (
            <details className="acc-item">
              <summary><span>Description</span><i className="acc-ico" aria-hidden="true" /></summary>
              <div className="acc-body">
                {product.description ? <FormattedDescription text={product.description} /> : <p>{product.shortDesc}</p>}
              </div>
            </details>
          )}

          <details className="acc-item">
            <summary><span>Return &amp; care</span><i className="acc-ico" aria-hidden="true" /></summary>
            <div className="acc-body">
              <h4>7-day return &amp; exchange</h4>
              <p>Not the right fit? Tell us within 7 days of delivery — returns are free, we arrange the courier pickup. Keep the tags and original packaging on, and the piece unworn and unwashed. Size or colour exchange is possible while stock allows.</p>
              <h4>Caring for it</h4>
              <p>Follow the care label inside the garment first, it is written for that exact fabric. As a rule: cold wash cotton and linen separately or inside out, no tumble dry, reshape while damp and iron on the reverse. Fold knitwear, hang shirting, and keep suede and wool away from damp.</p>
            </div>
          </details>

          <details className="acc-item">
            <summary><span>Delivery</span><i className="acc-ico" aria-hidden="true" /></summary>
            <div className="acc-body">
              <ul className="acc-list">
                <li>Inside Dhaka — usually {policies?.inside || "1-2 days"}</li>
                <li>Outside Dhaka — usually {policies?.outside || "2-4 days"}</li>
                <li>Cash on Delivery available all over Bangladesh</li>
                {policies?.freeAt ? <li>Free delivery on orders over ৳{policies.freeAt.toLocaleString("en-IN")}</li> : null}
                <li>Track the parcel any time with your order code on the tracking page</li>
              </ul>
            </div>
          </details>
        </div>
      </section>

      {/* size chart modal */}
      {chart && (sizeChartImage || sizeChartHtml) && (
        <div className="modal-bg sizechart-bg" onClick={() => setChart(false)}>
          <div className="modal sizechart-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setChart(false)} aria-label="Close">×</button>
            <h3>Size Chart</h3>
            {sizeChartImage && <img src={sizeChartImage} alt="Size chart" className="sizechart-img" />}
            {/* sizeChartHtml arrives already sanitised by the server component
                (app/products/[slug]/page.tsx → lib/sanitize). The four .replace() calls
                that used to run here were a blocklist, and 14 of 16 known payloads got
                through it: `<img/src=x/onerror=…>` and `<svg/onload=…>` (slash where the
                regex demanded \s), `<iframe>` (never filtered at all), entity-encoded
                `jav&#x09;ascript:`, a `<style>` CSS beacon, `<meta http-equiv=refresh>`,
                `<form action=…>`, `<scr<script>ipt>` reassembly, `<details/open/ontoggle>`,
                `<body/onload>`, `<input/autofocus/onfocus>` and an mXSS
                `<math><mtext><table><mglyph><style>` chain. Client-side filtering also
                ran after React had the string, on a value only the server could trust. */}
            {/* Rendered verbatim: the server component already sanitised this
                (lib/sanitize allow-list) and applied .sizechart-table. No client-side
                filtering is left, and none is needed. */}
            {!sizeChartImage && sizeChartHtml && (
              <div dangerouslySetInnerHTML={{ __html: sizeChartHtml }} />
            )}
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14 }}>Measurements are approximate. Between sizes? We recommend sizing up.</p>
          </div>
        </div>
      )}

      {/* ---------- LIGHTBOX (zoom) ---------- */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <div className="lb-top" onClick={(e) => e.stopPropagation()}>
            <button title={lbZoom ? "Zoom out" : "Zoom in"} onClick={() => setLbZoom(!lbZoom)} aria-label="Toggle zoom">
              {lbZoom ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
              )}
            </button>
            <button title="Close" onClick={() => setLightbox(false)} aria-label="Close">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="lb-count">{lbIdx + 1} / {N}</div>
          <img
            src={product.images[lbIdx]?.url || product.images[0]?.url}
            alt={product.images[lbIdx]?.alt || product.title}
            className={lbZoom ? "zoomed" : ""}
            style={lbZoom ? { transformOrigin: "50% 50%" } : undefined}
            onClick={(e) => { e.stopPropagation(); setLbZoom(!lbZoom); }}
            onMouseMove={(e) => { if (lbZoom) { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; } }}
            onTouchStart={onTouchStart}
            onTouchEnd={(e) => { e.stopPropagation(); onTouchEnd(e, true); }}
          />
          {N > 1 && (
            <>
              <button className="lb-nav prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setLbZoom(false); setLbIdx(((lbIdx - 1) % N + N) % N); }}>‹</button>
              <button className="lb-nav next" aria-label="Next" onClick={(e) => { e.stopPropagation(); setLbZoom(false); setLbIdx((lbIdx + 1) % N); }}>›</button>
            </>
          )}
        </div>
      )}
    </>
  );
}


/* Lightweight markdown-ish renderer for admin-formatted descriptions:
   ## heading · **bold** · _italic_ · ~~small~~ · • / ✓ list items */
function FormattedDescription({ text }: { text: string }) {
  const inline = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)_(.+?)_(?=\s|$|[,.;:!?)])/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, '<span style="font-size:.85em;color:var(--muted)">$1</span>');
  const blocks: React.ReactNode[] = [];
  let list: { icon: string; text: string }[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={"l" + blocks.length} style={{ margin: "8px 0", paddingLeft: 6, listStyle: "none", display: "grid", gap: 6 }}>
          {list.map((li, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "var(--text)", fontSize: 15 }}>
              <span style={{ color: "var(--accent)", fontWeight: 700, flex: "none" }}>{li.icon}</span>
              <span dangerouslySetInnerHTML={{ __html: inline(li.text) }} />
            </li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) { flush(); blocks.push(<h3 key={i} style={{ fontSize: 20, margin: "22px 0 6px", fontFamily: "var(--font-head)" }}>{line.replace(/^##\s+/, "")}</h3>); }
    else if (/^[•✓]\s+/.test(line)) { list.push({ icon: line[0], text: line.replace(/^[•✓]\s+/, "") }); }
    else if (line.trim() === "") { flush(); }
    else { flush(); blocks.push(<p key={i} style={{ marginBottom: 10, color: "var(--muted)", fontSize: 15.5, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: inline(line) }} />); }
  });
  flush();
  return <div style={{ maxWidth: 720 }}>{blocks}</div>;
}
