"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart, toast } from "@/components/store";
import { imgSrc, imgSrcSet } from "@/components/parts";
import { checkoutTotals, couponDiscount, nonNegativeAmount } from "@/lib/checkout-pricing";
import { FEATURES } from "@/lib/features";
import { ComboOffer } from "@/components/combo-offer";

/* Cart — original clean layout + "Continue Shopping" button on top. */
export default function CartPage() {
  const { lines, subtotal, setQty, updateLine, remove, ready } = useCart();
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [sizing, setSizing] = useState<string | null>(null);
  const [cfg, setCfg] = useState({ freeT: 0, inside: 80, outside: 140 });

  useEffect(() => {
    try {
      const c = JSON.parse(document.getElementById("sz-cfg")?.textContent || "{}");
      setCfg({
        /* freeDelivery off (lib/features.ts) ⇒ threshold 0 ⇒ "Add ৳X more for free delivery"
           note, progress bar ar FREE label ekbare gayeb. Delivery row normal charge dekhabe. */
        freeT: FEATURES.freeDelivery ? nonNegativeAmount(c?.shipping?.freeShippingThreshold) : 0,
        inside: nonNegativeAmount(c?.shipping?.insideDhaka, 80),
        outside: nonNegativeAmount(c?.shipping?.outsideDhaka, 140),
      });
    } catch {}
  }, []);

  const discount = couponDiscount(subtotal, applied);
  const effectiveTotal = subtotal - discount; // free shipping applies to discounted total
  const FREE_T = cfg.freeT;
  const { deliveryFee: ship, total } = checkoutTotals({
    subtotal, discount, area: "INSIDE_DHAKA", freeship: applied?.freeship,
    shipping: { insideDhaka: cfg.inside, outsideDhaka: cfg.outside, freeShippingThreshold: FREE_T },
  });
  const itemCount = lines.reduce((s, l) => s + (l.qty || 1), 0);
  /* Gift rows are free: the offer panel tracks their real market value so the
     summary can show what the shopper is getting on top of the subtotal. */
  const giftCount = lines.filter((l) => l.isGift).length;
  const giftValue = lines.filter((l) => l.isGift).reduce((s, l) => s + Number(l.giftValue || 0), 0);

  const bump = (l: any, q: number) => {
    if (q < 1) { remove(l.key); toast("Item removed from cart"); return; }
    setQty(l.key, q); // no toast per tap — instant feedback comes from the number itself
  };

  const changeSize = async (l: any, newSize: string) => {
    setSizing(l.key);
    try {
      const r = await fetch(`/api/cart/variant?productId=${l.productId}&size=${encodeURIComponent(newSize)}${l.color ? "&color=" + encodeURIComponent(l.color) : ""}`);
      const j = await r.json();
      if (r.ok && j.match) {
        updateLine(l.key, { variantId: j.match.id, price: j.match.price ?? l.price, size: newSize, stock: j.match.stock });
        toast("Cart item updated successfully");
      } else toast(`Size ${newSize} is out of stock`);
    } catch { toast("Network error"); }
    setSizing(null);
  };

  // lazy: old carts missing sizes[]
  useEffect(() => {
    if (!ready) return;
    for (const l of lines) {
      if (l.sizes && l.sizes.length) continue;
      fetch(`/api/cart/variant?productId=${l.productId}`)
        .then((r) => r.json())
        .then((j) => { if (j?.options?.length) updateLine(l.key, { sizes: j.options }); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lines.length]);

  const applyCoupon = async () => {
    if (!coupon.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/coupon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: coupon.trim(), subtotal }) });
      const j = await r.json();
      if (r.ok && j.valid) { setApplied(j); toast(`Coupon ${j.code} applied ✓`); }
      else { setApplied(null); toast(j.error || "Invalid coupon"); }
    } catch { toast("Network error"); }
    setBusy(false);
  };

  if (!ready) {
    return (
      <div className="container" aria-busy="true">
        <div className="cart-head" style={{ margin: "26px 0 18px" }}><div className="sk-line" style={{ width: 190, height: 26, margin: 0 }} /></div>
        {[0, 1].map((i) => (
          <div key={i} style={{ display: "flex", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="sk-block" style={{ width: 78, height: 104, margin: 0, flex: "none" }} />
            <div style={{ flex: 1 }}>
              <div className="sk-line" style={{ width: "52%", margin: "6px 0" }} />
              <div className="sk-line" style={{ width: "26%", margin: "6px 0" }} />
              <div className="sk-line" style={{ width: "18%", margin: "6px 0" }} />
            </div>
          </div>
        ))}
        <div className="sk-line" style={{ width: 150, height: 30, margin: "22px 0 0" }} />
        <span className="sr-only">Loading your cart…</span>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="container">
        <div className="cart-head">
          <div className="eyebrow">Shopping Cart</div>
          <h1>Your Cart</h1>
          <p className="cart-sub">0 items in your cart</p>
        </div>
        <div className="empty" style={{ padding: "60px 20px" }}>
          <h3>Your cart is empty</h3>
          <p>Discover pieces made to last.</p>
          <br /><Link className="btn" href="/products">Start Shopping</Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, FREE_T - effectiveTotal);

  return (
    <div className="container" style={{ padding: "34px 24px 100px" }}>
      <div className="cart-head">
        <div className="eyebrow">Shopping Cart</div>
        <h1>Your Cart</h1>
        <p className="cart-sub">{itemCount} item{itemCount !== 1 ? "s" : ""} in your cart</p>
        <Link className="btn btn-outline cart-continue" href="/products">Continue Shopping</Link>
      </div>

      <div className="cart-layout">
        <div>
          {lines.map((l) => (
            <div className="cart-row" key={l.key}>
              <Link href={"/products/" + l.slug}><img src={imgSrc(l.image, 200) || l.image} srcSet={imgSrcSet(l.image, [200, 300])} sizes="100px" alt={l.title} loading="lazy" decoding="async" width={100} height={126} /></Link>
              <div>
                <div className="t">
                  {l.isGift && <span className="gift-tag">Free gift</span>}
                  <Link href={"/products/" + l.slug}>{l.title}</Link>
                </div>
                <div className="v">{[l.size, l.color].filter(Boolean).join(" · ")}</div>
                <div className="v">
                  {l.isGift ? <><s className="gift-was">৳{Number(l.giftValue || 0).toLocaleString("en-IN")}</s> <b className="gift-free">FREE</b></> : <>৳{Number(l.price || 0).toLocaleString("en-IN")}</>}
                </div>
                {l.isGift ? (
                  <div className="gift-note">Added automatically by the offer · swap or remove it above</div>
                ) : (
                <>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Size</span>
                  <select className="cart-size-select" value={l.size || ""} onChange={(e) => changeSize(l, e.target.value)} aria-label="Change size" disabled={sizing === l.key} style={sizing === l.key ? { opacity: .6 } : undefined}>
                    {!l.size && <option value="">—</option>}
                    {l.size && <option value={l.size}>{l.size}</option>}
                    {(l.sizes || []).filter((s) => s && s !== l.size).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {sizing === l.key && <span className="spinner spin-sm" aria-hidden="true" style={{ width: 13, height: 13 }} />}
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="qty">
                    <button type="button" onClick={() => bump(l, (l.qty || 1) - 1)} aria-label="Decrease quantity">−</button>
                    <span>{l.qty}</span>
                    <button type="button" onClick={() => bump(l, (l.qty || 1) + 1)} aria-label="Increase quantity">+</button>
                  </div>
                  {l.stock != null && l.stock <= 5 && <span style={{ fontSize: 11, color: "var(--danger)" }}>only {l.stock} left</span>}
                </div>
                <button type="button" className="rm" onClick={() => { remove(l.key); toast("Item removed from cart"); }}>Remove</button>
                </>
                )}
              </div>
              <div style={{ fontWeight: 600 }}>{l.isGift ? <span className="gift-free">FREE</span> : <>৳{(Number(l.price || 0) * (l.qty || 1)).toLocaleString("en-IN")}</>}</div>
            </div>
          ))}
        </div>
        <div className="cart-aside">
          {/* Free-gift section sits directly above the order summary: it is the
              one thing a shopper must act on before the totals mean anything. */}
          <ComboOffer />
          <aside className="summary">
          <h3>Order Summary</h3>
          {FREE_T > 0 && <>
            <div className="freeship-note">
              {ship > 0 && remaining > 0 ? <>Add <b>৳{remaining.toLocaleString("en-IN")}</b> more for free delivery</> : <>🎉 You&apos;ve unlocked <b>free delivery</b></>}
            </div>
            <div className="freebar"><i style={{ width: (ship === 0 ? 100 : Math.min(100, (effectiveTotal / FREE_T) * 100)) + "%" }} /></div>
          </>}
          <div className="sum-row"><span>Subtotal ({itemCount} items)</span><span>৳{subtotal.toLocaleString("en-IN")}</span></div>
          {giftValue > 0 && <div className="sum-row"><span>Free gifts ({giftCount})</span><span className="gift-free">−৳{giftValue.toLocaleString("en-IN")}</span></div>}
          {discount > 0 && <div className="sum-row" style={{ color: "var(--ok)" }}><span>Discount ({applied.code})</span><span>−৳{discount.toLocaleString("en-IN")}</span></div>}
          <div className="sum-row"><span>Delivery (est.)</span><span>{(applied?.freeship || ship === 0) ? "Free" : "৳" + ship}</span></div>
          <div className="sum-row total"><span>Total</span><span>৳{total.toLocaleString("en-IN")}</span></div>
          <div className="coupon-row">
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
            <button className="abtn" onClick={applyCoupon} disabled={busy} aria-busy={busy || undefined}>
              {busy && <span className="spinner" aria-hidden="true" />}{busy ? "Checking" : "Apply"}
            </button>
          </div>
          <Link className="btn" style={{ width: "100%" }} href="/checkout">Proceed to Checkout</Link>
          <div className="trust">
            <span>🔒 Secure checkout</span><span>💵 Cash on Delivery</span><span>↩ 7-day returns</span>
          </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
