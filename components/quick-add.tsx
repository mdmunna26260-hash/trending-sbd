"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCart, toast } from "./store";
import { sortSizes } from "@/lib/sizes";

/* Quick add to cart, straight from a product card.
   - one size (or pre-order): a single tap adds it, no network roundtrip, because the server
     already put the default variant on the card data (`p.qa`).
   - several sizes / colours: a compact popover anchored to the card. It is portalled to
     <body> with fixed positioning on purpose — product rails use overflow-x:auto, and an
     absolutely positioned child of the card gets clipped by that scroller.
   In both cases the line is built exactly like the PDP does it (same cart.add payload), so the
   cart page's size switcher, the badge count and the AddToCart pixel event keep working. */

export type QaVariant = { variantId: number; price: number; stock: number; size?: string | null; color?: string | null };

export type QaProduct = {
  id: number; title: string; slug: string; price: number; image?: string;
  stock: number; sizes?: string[]; preorder?: boolean; qa?: QaVariant | null;
};

type Row = { id: number; size: string | null; color: string | null; price: number | null; stock: number };

const cache = new Map<number, Row[]>();

async function rowsFor(id: number): Promise<Row[]> {
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const r = await fetch("/api/cart/variant?productId=" + id);
    if (!r.ok) return [];
    const j = await r.json();
    const rows: Row[] = Array.isArray(j.variants) ? j.variants : [];
    cache.set(id, rows);
    return rows;
  } catch {
    return [];
  }
}

const money = (n: number) => "৳" + Number(n || 0).toLocaleString("en-IN");

export default function QuickAdd({ p }: { p: QaProduct }) {
  const { add } = useCart();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const soldOut = p.stock <= 0 && !p.preorder;
  const sizeCount = (p.sizes || []).length;

  const lineFor = (v: { variantId?: number; price?: number; stock?: number; size?: string | null; color?: string | null } | null) => {
    const stock = v && typeof v.stock === "number" ? v.stock : Math.max(p.stock, 1);
    return {
      productId: p.id,
      variantId: v?.variantId,
      slug: p.slug,
      title: p.title,
      image: p.image,
      price: v?.price || p.price,
      qty,
      size: v?.size || undefined,
      color: v?.color || undefined,
      stock: p.preorder ? 99 : Math.max(stock, 1),
      preorder: !!p.preorder,
    };
  };

  const commit = (v: Parameters<typeof lineFor>[0], close: boolean) => {
    if (busy) return;
    if (!p.preorder && v && typeof v.stock === "number" && v.stock <= 0) {
      toast("That size just sold out");
      setOpen(false);
      return;
    }
    setBusy(true);
    add(lineFor(v), qty);
    toast("Added to cart ✓");
    if (close) setOpen(false);
    setTimeout(() => setBusy(false), 380);
  };

  const onTap = async () => {
    if (busy) return;
    /* no choice to make → add immediately with the variant the server already gave us */
    if (sizeCount <= 1 && p.qa) {
      commit({ ...p.qa }, false);
      return;
    }
    const list = await rowsFor(p.id);
    const cols = Array.from(new Set(list.map((v) => v.color).filter(Boolean))) as string[];
    if (sizeCount <= 1 && cols.length <= 1) {
      const first = list.find((v) => v.stock > 0) || list[0];
      if (first) {
        commit({ variantId: first.id, price: first.price || p.price, stock: first.stock, size: first.size, color: first.color }, false);
        return;
      }
      if (!list.length) {
        commit(null, false);
        return;
      }
    }
    setRows(list);
    setColor(cols[0] ?? null);
    setQty(1);
    setOpen(true);
  };

  /* warm the variant list on hover so the popover opens with no wait */
  useEffect(() => {
    if (rows || sizeCount <= 1) return;
    let alive = true;
    const w = () => { void rowsFor(p.id).then((r) => { if (alive && r.length) setRows(r); }); };
    const t = setTimeout(w, 900);
    return () => { alive = false; clearTimeout(t); };
  }, [p.id, rows, sizeCount]);

  const place = useCallback(() => {
    const b = btnRef.current, pop = popRef.current;
    if (!b || !pop) return;
    const r = b.getBoundingClientRect();
    /* the card scrolled out of sight → nothing sensible to anchor to any more */
    if (r.bottom < -24 || r.top > window.innerHeight + 24 || r.width === 0) { setOpen(false); return; }
    const h = pop.offsetHeight, w = pop.offsetWidth;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = r.top - h - 8;
    if (top < 8) {
      top = r.bottom + 8;
      if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    }
    const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
    setPos((cur) => (cur && cur.left === Math.round(left) && cur.top === Math.round(top) ? cur : { left: Math.round(left), top: Math.round(top) }));
  }, []);

  useLayoutEffect(() => {
    if (!open) { if (pos !== null) setPos(null); return; }
    place();
  }, [open, rows, color, qty, pos, place]);

  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); }
    };
    /* reposition on scroll rather than close: closing made the popover vanish a frame after it
       opened whenever the page/rail was still settling (the scroll event arrives after the tap),
       and following the card is what a fixed popover should do anyway */
    let raf = 0;
    const move = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; place(); });
    };
    window.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open, place]);

  useEffect(() => {
    /* must wait for `pos`: until the popover has been measured and placed it is visibility:hidden,
       and a hidden element silently refuses focus() */
    if (!open || !pos) return;
    popRef.current?.querySelector<HTMLButtonElement>(".size-btn:not(:disabled)")?.focus({ preventScroll: true });
  }, [open, pos]);

  if (soldOut) return null;

  const list = rows || [];
  const forColor = color ? list.filter((v) => !v.color || v.color === color) : list;
  const colors = Array.from(new Set(list.map((v) => v.color).filter(Boolean))) as string[];
  const sizes = Array.from(new Set(forColor.map((v) => v.size).filter(Boolean))) as string[];
  const row = (s: string) => forColor.find((v) => v.size === s) || null;
  /* cap the stepper at the deepest stock any selectable size has — including the sold-out rows
     here made maxQty 0, which locked "+"/(1) and disabled the stepper for a perfectly fine product */
  const inStock = forColor.filter((v) => v.stock > 0);
  const maxQty = p.preorder || !inStock.length ? 10 : Math.min(10, Math.max(1, ...inStock.map((v) => v.stock)));
  const shown = sortSizes(
    sizes.length ? sizes : forColor.length === 0 && p.sizes && p.sizes.length ? p.sizes : []
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"qadd icon-btn" + (busy ? " busy" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={"Quick add " + p.title + " to cart"}
        title="Add to cart"
        onPointerEnter={() => { if (sizeCount > 1) void rowsFor(p.id); }}
        onClick={() => { void onTap(); }}
      >
        {busy ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="qadd-pop"
            ref={popRef}
            role="dialog"
            aria-label={"Choose size for " + p.title}
            style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : -9999, visibility: pos ? "visible" : "hidden" }}
          >
            <div className="qadd-head">
              <span className="qadd-title">{p.title}</span>
              <button type="button" className="qadd-x" aria-label="Close" onClick={() => { setOpen(false); btnRef.current?.focus(); }}>
                ×
              </button>
            </div>

            {colors.length > 1 && (
              <div className="qadd-row">
                <i>Colour</i>
                <div className="qadd-cols">
                  {colors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={"qadd-col" + (c === color ? " active" : "")}
                      aria-pressed={c === color}
                      onClick={() => setColor(c)}
                    >
                      <i style={{ background: ["white", "off-white", "cream", "black"].includes(c.toLowerCase()) ? (c.toLowerCase() === "black" ? "#16161a" : "#f4f0e8") : c.toLowerCase() }} />
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {shown.length > 0 && (
              <div className="qadd-row">
                <i>Size</i>
                <div className="qadd-sizes">
                  {shown.map((s) => {
                    const v = row(s);
                    const oos = !p.preorder && !!v && v.stock <= 0;
                    return (
                      <button
                        key={s}
                        type="button"
                        className={"size-btn" + (oos ? " qadd-oos" : "")}
                        disabled={oos}
                        title={v ? (oos ? "Sold out" : v.stock + " in stock") : undefined}
                        aria-label={v ? s + ", " + (oos ? "sold out" : v.stock + " in stock") : s}
                        onClick={() => {
                          if (!v) { commit({ variantId: undefined, price: p.price, stock: p.stock, size: s, color: color || undefined }, true); return; }
                          commit({ variantId: v.id, price: v.price || p.price, stock: v.stock, size: v.size, color: v.color }, true);
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="qadd-foot">
              <div className="qty" role="group" aria-label="Quantity">
                <button type="button" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <span aria-live="polite">{qty}</span>
                <button type="button" aria-label="Increase quantity" disabled={qty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))}>+</button>
              </div>
              <b className="qadd-price">{money(p.price * qty)}</b>
            </div>
            <div className="qadd-hint">Tap a size to add it</div>
          </div>,
          document.body
        )}
    </>
  );
}
