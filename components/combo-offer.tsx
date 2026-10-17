"use client";
/**
 * COMBO OFFER — storefront UI for the free-gift tier engine.
 *
 * THERE IS NO FETCH IN THIS FILE.
 * The server layout hands us the ACTIVE promotion as plain JSON and every number
 * below is computed synchronously during render with the same pure engine the
 * server uses. Nothing can leave the panel blank: if the engine ever throws we
 * fall back to a config-only view that still renders the ladder and the gifts.
 *
 * CLAIM PATTERN (v5.1):
 *   The cart shows a COMPACT summary — tier chips, one "claim" button, and (once
 *   picked) a single thumb row. The 20-odd gift choices live in a dedicated
 *   picker: a centred dialog on desktop, a bottom sheet on phones. A long grid
 *   of options inside a sticky cart column was pushing the totals and the
 *   "Proceed to checkout" button out of the shopper's view — bad for conversion.
 *
 * Used three times:
 *   <ComboOffer />           compact panel for the cart page
 *   <ComboOffer compact />   claim box for the checkout summary
 *   <ComboPdpHint />         one-line nudge for a product page
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useCart, toast, type CartLine } from "@/components/store";
import { imgSrc } from "@/components/parts";
import { evaluateCart, giftLinesToDrop, toComboView } from "@/lib/promotions/service";
import type { EnginePromotion, GiftSelectionMap } from "@/lib/promotions/types";
import { giftLabelText } from "@/lib/promotions/engine";

/* ------------------------------------------------------------------ types */

type Candidate = {
  productId: number; variantId: number; slug: string; name: string; image: string | null;
  size: string | null; color: string | null; label: string; price: number; comparePrice: number | null;
  stock: number; selectable: boolean;
};
type Slot = {
  key: string; selectionKey: string; tierIndex: number; label: string; giftType: string;
  status: string; message: string | null; blocking: boolean; locked: boolean;
  selectedVariantId: number | null; candidates: Candidate[];
};
type Tier = {
  index: number; label: string; requiredQuantity: number; quantityToGo: number;
  unlocked: boolean; isCurrent: boolean; slots: { key: string; label: string; quantity: number }[];
};
export type ComboView = {
  promotion: { id: string; slug: string; name: string; description: string | null; countMode: string; highestTierWins: boolean; requireGiftSelection: boolean; allowGiftSkipping: boolean };
  eligibleCount: number; currentTierIndex: number | null;
  nextTier: { index: number; label: string; requiredQuantity: number; quantityToGo: number } | null;
  tiers: Tier[]; slots: Slot[]; giftCount: number; giftValue: number; warnings: string[]; errors: string[];
};

/* -------------------------------------------------------- config (no fetch) */

export type PromotionConfig = { promotion: any | null; categories: Record<string, string> };
const ConfigCtx = createContext<PromotionConfig | null>(null);

export function PromotionConfigProvider({ config, children }: { config: PromotionConfig; children: React.ReactNode }) {
  const hydrated = useMemo<PromotionConfig>(() => {
    const p = config?.promotion;
    if (!p) return { promotion: null, categories: {} };
    return {
      promotion: { ...p, startsAt: p.startsAt ? new Date(p.startsAt) : null, endsAt: p.endsAt ? new Date(p.endsAt) : null },
      categories: config.categories || {},
    };
  }, [config]);
  return <ConfigCtx.Provider value={hydrated}>{children}</ConfigCtx.Provider>;
}

/* --------------------------------------------------------------- helpers */

const GIFT_KEY = (promotionId: string, tierIndex: number, slotKey: string) => `gift:${promotionId}:${tierIndex}:${slotKey}`;
const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
const selStoreKey = (promotionId: string) => `sz_gift_sel_${promotionId}`;
const rewardName = (label: string) => (label || "").replace(/^Buy \d+\s*—\s*/, "");
const shortReward = (label: string) => rewardName(label).replace(/Shirt \/ T-Shirt/i, "Shirt / Tee");

function readSelections(promotionId: string): Record<string, { productId: number; variantId: number }> {
  try { return JSON.parse(localStorage.getItem(selStoreKey(promotionId)) || "{}") || {}; } catch { return {}; }
}
function writeSelections(promotionId: string, map: Record<string, { productId: number; variantId: number }>) {
  try { localStorage.setItem(selStoreKey(promotionId), JSON.stringify(map)); } catch {}
}
function toEngineSelections(map: Record<string, { productId: number; variantId: number }>): GiftSelectionMap {
  const out: GiftSelectionMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = { productId: String(v.productId), variantId: String(v.variantId) };
  return out;
}
const giftLinesOf = (lines: CartLine[], promotionId: string) => lines.filter((l) => l.isGift && l.promotionId === promotionId);

/** Promo candidates (engine shape) → the picker's candidate shape. */
function toUiCandidates(engine: EnginePromotion, poolKey: string): Candidate[] {
  const pool = (engine.giftPools || []).find((g: any) => g.key === poolKey);
  if (!pool) return [];
  return (pool.candidates || []).map((c: any) => ({
    productId: Number(c.productId),
    variantId: Number(c.variantId),
    slug: c.productSlug,
    name: c.productName,
    image: c.imageUrl ?? null,
    size: c.colorName ?? null,
    color: c.variantLabel ?? null,
    label: c.variantLabel || "One size",
    price: (c.priceMinor || 0) / 100,
    comparePrice: c.compareAtMinor != null ? c.compareAtMinor / 100 : null,
    stock: c.stockQty || 0,
    selectable: !!c.selectable,
  }));
}

/**
 * Last-resort view built straight from the promotion config — no engine call.
 * Only used when the pure engine could not run, so the shopper still sees the
 * offer and the free pieces instead of an empty cart.
 */
function fallbackView(engine: EnginePromotion, lines: CartLine[]): ComboView {
  const paid = lines.filter((l) => !l.isGift);
  const count = engine.countMode === "DISTINCT_LINES"
    ? new Set(paid.map((l) => l.productId)).size
    : paid.reduce((s, l) => s + (l.qty || 1), 0);

  const tiers = engine.tiers.map((t: any) => ({
    index: t.index, label: t.label, requiredQuantity: t.requiredQuantity,
    quantityToGo: Math.max(0, t.requiredQuantity - count),
    unlocked: count >= t.requiredQuantity, isCurrent: false,
    slots: (t.slots || []).map((s: any) => ({ key: s.key, label: s.label, quantity: s.quantity })),
  }));
  const qualified = tiers.filter((t) => t.unlocked).sort((a, b) => a.index - b.index);
  const current = engine.highestTierWins ? qualified[qualified.length - 1] ?? null : qualified[0] ?? null;
  if (current) current.isCurrent = true;

  const held = giftLinesOf(lines, engine.id);
  const slots: Slot[] = (current ? engine.tiers.filter((t: any) => t.index === current.index) : []).flatMap((t: any) =>
    (t.slots || []).map((s: any) => {
      const key = `${t.index}:${s.key}`;
      const row = held.find((l) => l.tierIndex === t.index && l.slotKey === s.key);
      return {
        key, selectionKey: key, tierIndex: t.index, label: s.label, giftType: s.giftType,
        status: row ? "SELECTED" : "NEEDS_SELECTION",
        message: row ? null : `Choose your free ${giftLabelText(s.label).toLowerCase()}.`,
        blocking: false, locked: false,
        selectedVariantId: row?.variantId ?? null,
        candidates: toUiCandidates(engine, s.poolKey),
      };
    }),
  );

  const nextTier = tiers.filter((t) => !t.unlocked).sort((a, b) => a.requiredQuantity - b.requiredQuantity)[0] ?? null;
  const giftValue = held.reduce((s, l) => s + Number(l.giftValue || 0), 0);
  return {
    promotion: {
      id: engine.id, slug: engine.slug, name: engine.name, description: engine.description ?? null,
      countMode: engine.countMode, highestTierWins: engine.highestTierWins,
      requireGiftSelection: engine.requireGiftSelection, allowGiftSkipping: engine.allowGiftSkipping,
    },
    eligibleCount: count, currentTierIndex: current?.index ?? null,
    nextTier: nextTier ? { index: nextTier.index, label: nextTier.label, requiredQuantity: nextTier.requiredQuantity, quantityToGo: nextTier.quantityToGo } : null,
    tiers, slots, giftCount: held.length, giftValue, warnings: [], errors: [],
  };
}

/* ------------------------------------------------------- the gift picker

   A centred dialog on desktop, a bottom sheet on phones. The shopper stages a
   choice, sees what it costs them (৳0) and confirms — one clear decision on one
   screen instead of a 20-card grid inside the cart. */

function GiftPicker({
  promotionId, slot, onClose, onConfirm,
}: {
  promotionId: string;
  slot: Slot;
  onClose: () => void;
  onConfirm: (c: Candidate) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [staged, setStaged] = useState<Candidate | null>(
    () => slot.candidates.find((c) => c.variantId === slot.selectedVariantId) ?? null,
  );
  const [query, setQuery] = useState("");

  useEffect(() => { setMounted(true); }, []);

  /* Esc to close + freeze the page behind the sheet. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (!mounted) return null;

  const selectable = slot.candidates.filter((c) => c.selectable);
  const shown = query.trim()
    ? selectable.filter((c) => `${c.name} ${c.label}`.toLowerCase().includes(query.trim().toLowerCase()))
    : selectable;

  return createPortal(
    <div className="gift-backdrop" role="presentation" onClick={onClose}>
      <div
        className="gift-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Choose your free ${giftLabelText(slot.label)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gift-modal-head">
          <div>
            <div className="combo-kicker"><span className="ed-kicker-mark" aria-hidden />Free gift</div>
            <h2 className="gift-modal-title">Choose your free {giftLabelText(slot.label).toLowerCase()}</h2>
            <p className="gift-modal-sub">
              {selectable.length} piece{selectable.length === 1 ? "" : "s"} to pick from · yours at <b>৳0</b>
            </p>
          </div>
          <button type="button" className="gift-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {selectable.length > 8 && (
          <div className="gift-modal-search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search size, colour or name…" aria-label="Search gifts" />
          </div>
        )}

        <div className="gift-modal-body">
          <div className="gift-grid">
            {shown.map((c) => {
              const on = staged?.variantId === c.variantId;
              return (
                <button
                  type="button"
                  key={c.variantId}
                  className={"gift-card" + (on ? " on" : "")}
                  aria-pressed={on}
                  onClick={() => setStaged(c)}
                >
                  <span className="gift-card-media">
                    {c.image
                      ? <img src={imgSrc(c.image, 240) || c.image} alt="" loading="lazy" />
                      : <span className="gift-card-noimg" aria-hidden />}
                    <span className="gift-card-free">FREE</span>
                    {on && <span className="gift-card-check" aria-hidden>✓</span>}
                  </span>
                  <span className="gift-card-name">{c.name}</span>
                  <span className="gift-card-meta">{c.label}</span>
                  <span className="gift-card-price">
                    <s>{money(c.comparePrice || c.price)}</s> <b>৳0</b>
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="gift-empty">
                {query ? "Nothing matches that search." : "Every piece in this pool is out of stock right now."}
              </p>
            )}
          </div>
        </div>

        <footer className="gift-modal-foot">
          <div className="gift-foot-copy">
            {staged
              ? <><b>{staged.name}</b><span>{staged.label} · <s>{money(staged.comparePrice || staged.price)}</s> ৳0</span></>
              : <span>Pick a piece above — it is added to your order for free.</span>}
          </div>
          <button type="button" className="btn gift-foot-skip" onClick={onClose}>Not now</button>
          <button
            type="button"
            className="btn gift-foot-add"
            disabled={!staged}
            onClick={() => { if (staged) onConfirm(staged); }}
          >
            {slot.selectedVariantId ? "Update gift" : "Add free gift"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------ main panel */

export function ComboOffer({ compact = false }: { compact?: boolean }) {
  const { lines, ready, addGiftLine, removeKeys } = useCart();
  const config = useContext(ConfigCtx);
  const engine = (config?.promotion ?? null) as EnginePromotion | null;

  const [pickerSlot, setPickerSlot] = useState<Slot | null>(null);
  const [tick, setTick] = useState(0);
  const [useFallback, setUseFallback] = useState(false);

  /* Everything is computed HERE, during render — no effects, no requests, so
     there is no window in which the panel can be empty. */
  const evaluated = useMemo(() => {
    if (!engine || !ready) return null;
    try {
      const selections = readSelections(engine.id);
      const held = giftLinesOf(lines, engine.id);

      let healed = false;
      for (const l of held) {
        if (l.tierIndex == null || !l.slotKey || l.variantId == null) continue;
        const sk = `${l.tierIndex}:${l.slotKey}`;
        const cur = selections[sk];
        if (!cur || Number(cur.variantId) !== Number(l.variantId) || Number(cur.productId) !== Number(l.productId)) {
          selections[sk] = { productId: Number(l.productId), variantId: Number(l.variantId) };
          healed = true;
        }
      }
      if (healed) writeSelections(engine.id, selections);

      const evaluation = evaluateCart({
        promotion: engine,
        lines: lines as any,
        selections: toEngineSelections(selections),
        categories: config?.categories ?? {},
        grantedTierIndex: null,
      });
      return { evaluation, view: toComboView(engine, evaluation) as unknown as ComboView, held };
    } catch (err) {
      console.warn("[combo-offer] engine evaluation failed — using config-only view", err);
      return null;
    }
  }, [engine, ready, lines, config, tick]);

  const view = useMemo<ComboView | null>(() => {
    if (!engine) return null;
    if (evaluated) return evaluated.view;
    return useFallback ? fallbackView(engine, lines) : null;
  }, [engine, evaluated, useFallback, lines]);

  useEffect(() => {
    if (!engine || evaluated || useFallback || !ready) return;
    setUseFallback(true);
  }, [engine, evaluated, ready, useFallback]);

  /* Gift rows the cart no longer earns are removed; selections whose cart row
     was removed by hand are forgotten. */
  useEffect(() => {
    if (!engine || !evaluated || useFallback) return;
    const drop = giftLinesToDrop(evaluated.evaluation, lines as any);
    if (drop.length) { removeKeys(drop); return; }
    const heldKeys = new Set(evaluated.held.map((l) => l.key));
    const selections = readSelections(engine.id);
    const next = { ...selections };
    let changed = false;
    for (const slot of evaluated.evaluation.slots) {
      if (slot.status !== "SELECTED") continue;
      if (!heldKeys.has(GIFT_KEY(engine.id, slot.tierIndex, slot.slotKey))) { delete next[slot.key]; changed = true; }
    }
    if (changed) { writeSelections(engine.id, next); setTick((t) => t + 1); }
  }, [engine, evaluated, useFallback, lines, removeKeys]);

  const choose = useCallback((promotionId: string, slot: Slot, candidate: Candidate) => {
    const selections = readSelections(promotionId);
    selections[slot.selectionKey] = { productId: candidate.productId, variantId: candidate.variantId };
    writeSelections(promotionId, selections);
    addGiftLine({
      key: GIFT_KEY(promotionId, slot.tierIndex, slot.key),
      productId: candidate.productId,
      variantId: candidate.variantId,
      slug: candidate.slug,
      title: candidate.name,
      image: candidate.image ?? undefined,
      price: 0,
      qty: 1,
      color: candidate.label ?? undefined,
      stock: candidate.stock,
      isGift: true,
      promotionId,
      tierIndex: slot.tierIndex,
      slotKey: slot.key,
      giftValue: candidate.price,
    });
    setPickerSlot(null);
    toast(`${candidate.name} added as your free gift ✓`);
    setTick((t) => t + 1);
  }, [addGiftLine]);

  const dropGift = useCallback((promotionId: string, slot: Slot) => {
    const selections = readSelections(promotionId);
    delete selections[slot.selectionKey];
    writeSelections(promotionId, selections);
    removeKeys([GIFT_KEY(promotionId, slot.tierIndex, slot.key)]);
    toast("Free gift removed");
    setTick((t) => t + 1);
  }, [removeKeys]);

  if (!engine || !view || view.tiers.length === 0) return null;

  const p = view.promotion;
  const next = view.nextTier;
  const needSelection = view.slots.filter((s) => s.status === "NEEDS_SELECTION");
  const heldSlots = view.slots.filter((s) => s.status === "SELECTED");
  const optional = p.requireGiftSelection && p.allowGiftSkipping;
  const goal = next ? next.requiredQuantity : view.tiers.find((t) => t.isCurrent)?.requiredQuantity ?? 1;
  const pct = Math.min(100, Math.round((view.eligibleCount / goal) * 100));

  /* the picker itself — shared by the cart panel and the checkout box */
  const picker = pickerSlot ? (
    <GiftPicker
      promotionId={p.id}
      slot={pickerSlot}
      onClose={() => setPickerSlot(null)}
      onConfirm={(c) => choose(p.id, pickerSlot, c)}
    />
  ) : null;

  const heldRow = (slot: Slot) => {
    const cand = slot.candidates.find((c) => c.variantId === slot.selectedVariantId);
    return (
      <div className="gift-held" key={slot.selectionKey}>
        <span className="gift-held-media">
          {cand?.image ? <img src={imgSrc(cand.image, 200) || cand.image} alt="" loading="lazy" /> : <span aria-hidden />}
        </span>
        <span className="gift-held-copy">
          <span className="gift-held-tag">Free gift</span>
          <b>{cand?.name || slot.label}</b>
          <span className="gift-held-meta">
            {[cand?.label, cand ? `${money(cand.price)} → ৳0` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="gift-held-actions">
          <button type="button" className="combo-link" onClick={() => setPickerSlot(slot)}>Change</button>
          <button type="button" className="combo-link danger" onClick={() => dropGift(p.id, slot)}>Remove</button>
        </span>
      </div>
    );
  };

  /* ------------------------------------------------------- compact (checkout) */
  if (compact) {
    if (!needSelection.length && !heldSlots.length) return null;
    return (
      <section className="combo is-compact" aria-label="Free gift offer">
        {picker}
        <div className="combo-compact-head">
          <span className="combo-hint-tag">Free gift</span>
          <span className="combo-compact-copy">
            {needSelection.length > 0
              ? <>You unlocked <b>{rewardName(needSelection[0].label)}</b> — pick it and it goes in this order at ৳0.</>
              : <>Your free {heldSlots.length > 1 ? "pieces are" : "piece is"} in this order — <b>{money(view.giftValue)}</b> off.</>}
          </span>
        </div>

        {needSelection.length > 0 && (
          <div className="combo-cta-row">
            <button type="button" className="btn combo-cta" onClick={() => setPickerSlot(needSelection[0])}>
              Choose your free {giftLabelText(needSelection[0].label).toLowerCase()}
            </button>
          </div>
        )}
        {needSelection.length === 0 && heldSlots.map(heldRow)}

        {needSelection.length > 0 && (
          <p className="combo-skip">
            {optional ? "Optional — you can also place the order without it." : "Pick one to continue."}{" "}
            <Link href="/cart" className="combo-hint-link">cart →</Link>
          </p>
        )}
      </section>
    );
  }

  /* ------------------------------------------------------------- cart panel */
  return (
    <section className="combo" aria-label="Free gift offer">
      {picker}

      <header className="combo-head">
        <div>
          <div className="combo-kicker"><span className="ed-kicker-mark" aria-hidden />{p.name}</div>
          <p className="combo-sub">
            {view.eligibleCount} qualifying item{view.eligibleCount === 1 ? "" : "s"}
            {next
              ? <> · <b>{next.quantityToGo} more</b> for {shortReward(next.label).toLowerCase()}</>
              : <> · every reward unlocked ✓</>}
          </p>
        </div>
        {view.giftCount > 0 && <div className="combo-saved">Free pieces <b>{money(view.giftValue)}</b></div>}
      </header>

      <div className="combo-bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(view.eligibleCount, goal)}>
        <i style={{ width: pct + "%" }} />
      </div>

      {/* The ladder as three chips instead of three stacked rows — the cart
          column stays short so the totals never leave the screen. */}
      <ul className="combo-steps">
        {view.tiers.map((t) => (
          <li key={t.index} className={t.isCurrent ? "on" : t.unlocked ? "done" : ""}>
            <b>{t.requiredQuantity}</b>
            <span>{shortReward(t.label)}</span>
            {t.isCurrent && <i aria-hidden>✓</i>}
          </li>
        ))}
      </ul>

      {needSelection.length > 0 && (
        <div className="combo-claim">
          <button type="button" className="btn combo-cta" onClick={() => setPickerSlot(needSelection[0])}>
            Claim your free {needSelection[0].label.toLowerCase()}
          </button>
          <span className="combo-skip-inline">
            {(() => {
              const n = needSelection[0].candidates.filter((c) => c.selectable).length;
              const best = needSelection[0].candidates.find((c) => c.selectable);
              return n > 0 ? `${n} to choose from · worth ${money(best!.price)}` : "restocking soon";
            })()}
          </span>
          {optional && <p className="combo-skip">Optional — you can also order without a gift.</p>}
        </div>
      )}

      {needSelection.length === 0 && heldSlots.map(heldRow)}

      {next && needSelection.length === 0 && heldSlots.length === 0 && (
        <div className="combo-cta-row">
          <Link href="/products" className="btn combo-cta">
            {view.eligibleCount === 0
              ? `Shop — ${next.quantityToGo} items, get a free ${shortReward(next.label).toLowerCase()} →`
              : `Add ${next.quantityToGo} more for ${shortReward(next.label).toLowerCase()} →`}
          </Link>
          <span className="combo-skip-inline">{view.eligibleCount} qualifying item{view.eligibleCount === 1 ? "" : "s"} so far</span>
        </div>
      )}

      {view.warnings.map((w) => <p className="combo-warn" key={w}>{w}</p>)}
    </section>
  );
}

/* --------------------------------------------------------- PDP one-liner */

export function ComboPdpHint() {
  const { lines, ready } = useCart();
  const config = useContext(ConfigCtx);
  const engine = (config?.promotion ?? null) as EnginePromotion | null;

  const view = useMemo<ComboView | null>(() => {
    if (!engine || !ready) return null;
    try {
      const evaluation = evaluateCart({
        promotion: engine, lines: lines as any,
        selections: toEngineSelections(readSelections(engine.id)),
        categories: config?.categories ?? {},
      });
      return toComboView(engine, evaluation) as unknown as ComboView;
    } catch {
      return fallbackView(engine, lines);
    }
  }, [engine, ready, lines, config]);

  if (!view || view.tiers.length === 0) return null;
  const next = view.nextTier;
  if (next) {
    return (
      <div className="combo-hint">
        <span className="combo-hint-tag">Free gift</span>
        <span>
          Add <b>{next.quantityToGo}</b> more {next.quantityToGo === 1 ? "piece" : "pieces"} to get{" "}
          <b>{rewardName(next.label)}</b>
        </span>
        <Link href="/cart" className="combo-hint-link">cart →</Link>
      </div>
    );
  }
  const needs = view.slots.filter((s) => s.status === "NEEDS_SELECTION");
  const currentTier = view.tiers.find((t) => t.isCurrent);
  return (
    <div className="combo-hint unlocked">
      <span className="combo-hint-tag">{needs.length ? "Free gift" : "Unlocked"}</span>
      <span>
        {needs.length
          ? <>Your free <b>{rewardName(needs[0].label)}</b> is unlocked — </>
          : <>Free <b>{currentTier ? rewardName(currentTier.label) : "piece"}</b> is in your cart — </>}
        <Link href="/cart" className="combo-hint-link">claim it in the cart →</Link>
      </span>
    </div>
  );
}
