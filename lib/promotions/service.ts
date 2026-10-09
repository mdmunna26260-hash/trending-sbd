/**
 * PROMOTIONS — storefront service
 *
 * Bridges THIS repo's cart (a plain localStorage array, see components/store.tsx)
 * to the pure engine, and shapes the result for:
 *   · the cart UI (ladder + gift picker)
 *   · the checkout route (server-authoritative re-validation)
 *
 * The browser and the server run the SAME evaluation. The browser's copy is for
 * display; the server's copy is the one that creates the order, so a tampered
 * localStorage cart can never turn into a free order.
 */
import {
  evaluatePromotion,
  giftLineKey,
  slotSelectionKey,
} from "./engine";
import { toMinorSafe as toMinor } from "@/lib/money";
import type {
  EngineCartLine,
  EnginePromotion,
  GiftSelectionMap,
  PromotionEvaluation,
} from "./types";

/** components/store.tsx CartLine — mirrored here to keep the engine decoupled. */
export type StoreCartLine = {
  key: string;
  productId: number;
  variantId?: number;
  slug: string;
  title: string;
  image?: string;
  price: number;
  qty: number;
  size?: string;
  color?: string;
  stock: number;
  sizes?: string[];
  preorder?: boolean;
  /* ---- gift lines (added by this feature) ---- */
  isGift?: boolean;
  promotionId?: string;
  tierIndex?: number;
  slotKey?: string;
};

/** productId → categoryId, needed only when eligibility is CATEGORIES-scoped. */
export type CategoryIndex = Record<string, string>;

export function toEngineLines(lines: StoreCartLine[], categories: CategoryIndex = {}): EngineCartLine[] {
  return lines.map((l) => ({
    lineKey: l.key,
    productId: String(l.productId),
    variantId: l.variantId != null ? String(l.variantId) : "",
    categoryId: categories[String(l.productId)] ?? "",
    quantity: l.qty,
    isGift: !!l.isGift,
    promotionId: l.promotionId ?? null,
    promotionTierIndex: l.tierIndex ?? null,
    giftSlotKey: l.slotKey ?? null,
  }));
}

export function evaluateCart(input: {
  promotion: EnginePromotion;
  lines: StoreCartLine[];
  selections?: GiftSelectionMap;
  categories?: CategoryIndex;
  grantedTierIndex?: number | null;
  now?: Date;
}): PromotionEvaluation {
  return evaluatePromotion({
    promotion: input.promotion,
    lines: toEngineLines(input.lines, input.categories),
    selections: input.selections ?? {},
    now: input.now ?? new Date(),
    grantedTierIndex: input.grantedTierIndex ?? null,
  });
}

/** The selection map key for one slot — the only place this format is built. */
export const selectionKeyFor = (tierIndex: number, slotKey: string) => slotSelectionKey(tierIndex, slotKey);

/** Deterministic cart-line key for a granted gift (one line per slot). */
export const giftCartLineKey = (promotionId: string, tierIndex: number, slotKey: string) =>
  giftLineKey(promotionId, tierIndex, slotKey);

/**
 * Builds the cart line a chosen gift becomes. Price is 0 in the UI, and the
 * server overwrites it with 0 again at checkout — display convenience only.
 */
export function giftToCartLine(input: {
  promotionId: string;
  tierIndex: number;
  slotKey: string;
  candidate: { productId: string; variantId: string; productSlug: string; productName: string; imageUrl: string | null; variantLabel: string; colorName: string | null; stockQty: number };
}): StoreCartLine {
  const label = input.candidate.variantLabel;
  const slash = label.indexOf(" / ");
  const size = slash > -1 ? label.slice(0, slash) : label === "One size" ? undefined : label;
  const color = input.candidate.colorName ?? (slash > -1 ? label.slice(slash + 3) : undefined);
  return {
    key: giftCartLineKey(input.promotionId, input.tierIndex, input.slotKey),
    productId: Number(input.candidate.productId),
    variantId: Number(input.candidate.variantId),
    slug: input.candidate.productSlug,
    title: input.candidate.productName,
    image: input.candidate.imageUrl ?? undefined,
    price: 0,
    qty: 1,
    size,
    color,
    stock: input.candidate.stockQty,
    isGift: true,
    promotionId: input.promotionId,
    tierIndex: input.tierIndex,
    slotKey: input.slotKey,
  };
}

/* ------------------------------------------------------------------ *
 * UI payload — what /api/promotions/active returns to the browser.
 * Money is converted back to taka here; the engine stays in minor units.
 * ------------------------------------------------------------------ */

export type ComboCandidateView = {
  productId: number;
  variantId: number;
  slug: string;
  name: string;
  image: string | null;
  size: string | null;
  color: string | null;
  label: string;
  price: number;
  comparePrice: number | null;
  stock: number;
  selectable: boolean;
};

export type ComboSlotView = {
  key: string;
  selectionKey: string;
  tierIndex: number;
  label: string;
  giftType: string;
  status: string;
  message: string | null;
  blocking: boolean;
  locked: boolean;
  selectedVariantId: number | null;
  candidates: ComboCandidateView[];
};

export type ComboTierView = {
  index: number;
  label: string;
  requiredQuantity: number;
  quantityToGo: number;
  unlocked: boolean;
  isCurrent: boolean;
  slots: { key: string; label: string; quantity: number }[];
};

export type ComboView = {
  promotion: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    countMode: string;
    highestTierWins: boolean;
    requireGiftSelection: boolean;
    allowGiftSkipping: boolean;
  };
  eligibleCount: number;
  currentTierIndex: number | null;
  nextTier: { index: number; label: string; requiredQuantity: number; quantityToGo: number } | null;
  tiers: ComboTierView[];
  slots: ComboSlotView[];
  giftCount: number;
  giftValue: number;
  warnings: string[];
  errors: string[];
};

const taka = (minor: number) => Math.round(minor) / 100;

/** Only the candidates of slots that are actually grantable ride to the client. */
export function toComboView(promotion: EnginePromotion, evaluation: PromotionEvaluation): ComboView {
  const liveSlots = evaluation.slots.filter((s) => s.status === "SELECTED" || s.status === "NEEDS_SELECTION" || s.status === "OUT_OF_STOCK" || s.status === "INELIGIBLE_SELECTION" || s.status === "UNAVAILABLE");

  return {
    promotion: {
      id: promotion.id,
      slug: promotion.slug,
      name: promotion.name,
      description: promotion.description,
      countMode: promotion.countMode,
      highestTierWins: promotion.highestTierWins,
      requireGiftSelection: promotion.requireGiftSelection,
      allowGiftSkipping: promotion.allowGiftSkipping,
    },
    eligibleCount: evaluation.eligibleCount,
    currentTierIndex: evaluation.currentTierIndex,
    nextTier: evaluation.nextTier
      ? {
          index: evaluation.nextTier.index,
          label: evaluation.nextTier.label,
          requiredQuantity: evaluation.nextTier.requiredQuantity,
          quantityToGo: evaluation.nextTier.quantityToGo,
        }
      : null,
    tiers: evaluation.tiers.map((t) => ({
      index: t.index,
      label: t.label,
      requiredQuantity: t.requiredQuantity,
      quantityToGo: t.quantityToGo,
      unlocked: t.unlocked,
      isCurrent: t.isCurrent,
      slots: t.slots.map((s) => ({ key: s.key, label: s.label, quantity: s.quantity })),
    })),
    slots: liveSlots.map((s) => ({
      key: s.slotKey,
      selectionKey: s.key,
      tierIndex: s.tierIndex,
      label: s.label,
      giftType: s.giftType,
      status: s.status,
      message: s.message,
      blocking: s.blocking,
      locked: s.locked,
      selectedVariantId: s.selected ? Number(s.selected.variantId) : null,
      candidates: s.candidates.map((c) => {
        const parts = c.variantLabel.split(" / ");
        return {
          productId: Number(c.productId),
          variantId: Number(c.variantId),
          slug: c.productSlug,
          name: c.productName,
          image: c.imageUrl,
          size: parts[0] === "One size" ? null : parts[0] ?? null,
          color: c.colorName ?? parts[1] ?? null,
          label: c.variantLabel,
          price: taka(c.priceMinor),
          comparePrice: c.compareAtMinor != null ? taka(c.compareAtMinor) : null,
          stock: c.stockQty,
          selectable: c.selectable,
        };
      }),
    })),
    giftCount: evaluation.giftCount,
    giftValue: taka(evaluation.giftValueMinor),
    warnings: evaluation.warnings,
    errors: evaluation.errors,
  };
}

/** Server-side guard: which gift lines in the cart are still legitimate? */
export function giftLinesToDrop(evaluation: PromotionEvaluation, lines: StoreCartLine[]) {
  const grantedKeys = new Set(evaluation.grantedGifts.map((g) => g.lineKey));
  return lines
    .filter((l) => l.isGift && l.promotionId === evaluation.promotionId && !grantedKeys.has(l.key))
    .map((l) => l.key);
}

/* (toMinor re-export removed — it lives in @/lib/money and nothing imported it from here.) */
