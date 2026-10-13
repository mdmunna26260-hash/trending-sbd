/**
 * PROMOTION ENGINE — authoritative, pure business logic.
 *
 * NOTHING in this file touches the database, React, or `fetch`. It is a total
 * function from (promotion, cart lines, selections, now) to a complete
 * evaluation. That means:
 *   • the cart page, the checkout transaction and the admin preview all call
 *     the SAME implementation (§60: one authoritative implementation);
 *   • it is unit-testable without a database (see tests/unit/promotion-engine).
 *
 * The rules implemented below:
 *   §14  The promotion is re-evaluated after every cart mutation.
 *   §15  Tiers: 3 items → 1 shirt/tee, 4 → 1 denim pant, 6 → jeans + shirt.
 *   §16  Eligibility is data-driven (products/categories/scope), never hard-coded.
 *   §17  A product can be purchasable but excluded from being a gift.
 *   §18  Highest tier wins: a tier-1 gift is replaced when tier 2 unlocks.
 *   §19  An invalid gift can never survive in the cart.
 *   §20  Optional gift locking (default OFF) with full re-validation.
 *   §22  Gift stock is validated; out-of-stock gifts must be replaced.
 */

/* percentOfMinor and sumMinor join the mulMinor import that was already here.
   lib/money.ts is itself pure (no DB, no React, no fetch), so this does not weaken
   this module's "nothing touches the database" contract — it removes second copies
   of the currency arithmetic that could otherwise drift away from it. */
import { mulMinor, percentOfMinor, sumMinor } from '@/lib/money';
import type {
  EngineCartLine,
  EngineGiftPool,
  EnginePromotion,
  EngineTier,
  EvaluatedTier,
  EvaluatePromotionInput,
  GiftCandidate,
  GiftSelection,
  GiftSelectionMap,
  PromotionEvaluation,
  PromotionInactiveReason,
  ResolvedGiftSlot,
} from './types';

/** Deterministic line identity for gift lines — one row per (tier, slot). */
export function giftLineKey(promotionId: string, tierIndex: number, slotKey: string): string {
  return `gift:${promotionId}:${tierIndex}:${slotKey}`;
}

/** Deterministic line identity for paid lines — one row per purchased variant. */
export function paidLineKey(variantId: string): string {
  return `paid:${variantId}`;
}

export function slotSelectionKey(tierIndex: number, slotKey: string): string {
  return `${tierIndex}:${slotKey}`;
}

/** Lowest quantity that qualifies for any tier — the floor that gift-locking respects. */
export function qualifyingFloor(promotion: EnginePromotion): number {
  if (promotion.tiers.length === 0) return Number.POSITIVE_INFINITY;
  return promotion.tiers.reduce((min, tier) => Math.min(min, tier.requiredQuantity), Number.POSITIVE_INFINITY);
}

export function isPromotionLive(promotion: EnginePromotion, now: Date): PromotionInactiveReason | null {
  if (promotion.status !== 'ACTIVE') {
    if (promotion.status === 'PAUSED') return 'PAUSED';
    if (promotion.status === 'ENDED') return 'ENDED';
    return 'DRAFT';
  }
  if (promotion.startsAt.getTime() > now.getTime()) return 'NOT_STARTED';
  if (promotion.endsAt && promotion.endsAt.getTime() < now.getTime()) return 'ENDED';
  if (promotion.maxOrders !== null && promotion.usedOrders >= promotion.maxOrders) return 'ORDER_LIMIT_REACHED';
  if (promotion.tiers.length === 0 && promotion.type === 'GIFT_TIERS') return 'NO_TIERS';
  return null;
}

/**
 * Does this paid cart line count toward the promotion?
 * Gift lines never count (§19) — otherwise a gift would unlock more gifts.
 */
export function isEligiblePurchaseLine(promotion: EnginePromotion, line: EngineCartLine): boolean {
  if (line.isGift) return false;
  if (line.quantity <= 0) return false;

  if (promotion.excludedProductIds.includes(line.productId)) return false;
  if (promotion.eligibilityScope === 'ALL_PRODUCTS') return true;
  if (promotion.eligibilityScope === 'PRODUCTS') {
    return promotion.eligibleProductIds.includes(line.productId);
  }
  // CATEGORIES — excluded categories subtract from the scope even inside the list.
  if (promotion.excludedCategoryIds.includes(line.categoryId)) return false;
  return promotion.eligibleCategoryIds.includes(line.categoryId);
}

export interface EligibilityCount {
  count: number;
  quantity: number;
  lineKeys: string[];
}

/** Counts qualifying items using the promotion's `countMode`. */
export function countEligibleItems(promotion: EnginePromotion, lines: EngineCartLine[]): EligibilityCount {
  const eligible = lines.filter((line) => isEligiblePurchaseLine(promotion, line));
  const quantity = eligible.reduce((total, line) => total + line.quantity, 0);
  const count = promotion.countMode === 'DISTINCT_LINES' ? eligible.length : quantity;
  return { count, quantity, lineKeys: eligible.map((line) => line.lineKey) };
}

/** Highest tier whose threshold is met, or null when nothing qualifies. */
export function resolveTierIndex(promotion: EnginePromotion, count: number): number | null {
  const qualified = promotion.tiers
    .filter((tier) => count >= tier.requiredQuantity)
    .sort((a, b) => a.index - b.index);
  const best = qualified.at(-1);
  return best ? best.index : null;
}

function tierByIndex(promotion: EnginePromotion, index: number | null): EngineTier | null {
  if (index === null) return null;
  return promotion.tiers.find((tier) => tier.index === index) ?? null;
}

function toEvaluatedTier(tier: EngineTier, currentIndex: number | null, grantedIndexes: number[], count: number): EvaluatedTier {
  return {
    index: tier.index,
    key: tier.key,
    label: tier.label,
    requiredQuantity: tier.requiredQuantity,
    quantityToGo: Math.max(0, tier.requiredQuantity - count),
    unlocked: currentIndex !== null && count >= tier.requiredQuantity,
    isCurrent: currentIndex === tier.index,
    isGranted: grantedIndexes.includes(tier.index),
    slots: tier.slots.map((slot) => ({
      key: slot.key,
      label: slot.label,
      giftType: slot.giftType,
      quantity: slot.quantity,
    })),
  };
}

/** Is this candidate allowed to be handed out as a gift — for this promotion, and for this pool?
    `pool` na dileo kaj kore (promotion-level rule), kintu slot resolution kokhono pool ta dey, tai
    per-rule exclusion (pool.excludeProductIds) o ekhanei ek jaygay apply hoy. */
export function isCandidateGiftable(promotion: EnginePromotion, candidate: GiftCandidate, pool?: EngineGiftPool | null): boolean {
  if (!candidate.selectable) return false; // variant inactive / archived product
  if (!candidate.productId || !candidate.variantId) return false;
  if (promotion.excludedGiftProductIds.includes(candidate.productId)) return false;
  if (pool?.excludeProductIds?.includes(candidate.productId)) return false; // per-rule exclusion
  return true;
}

function findPool(promotion: EnginePromotion, poolKey: string): EngineGiftPool | null {
  return promotion.giftPools.find((pool) => pool.key === poolKey) ?? null;
}

export const GIFT_MESSAGES = {
  unavailable: 'This gift is currently unavailable. Please choose another gift.',
  noLongerInPromotion: 'This gift is no longer part of the offer. Please choose another gift.',
  soldOutPool: 'All gifts for this tier are out of stock right now. You can still check out — a replacement will be offered as soon as stock returns.',
  choose: (label: string) => `Choose your free ${label.toLowerCase()}.`,
  lockedKept: 'Your free gift from this offer has been kept — it stays valid while your cart still qualifies.',
} as const;

interface ResolveSlotOptions {
  promotion: EnginePromotion;
  tier: EngineTier;
  slotIndex: number;
  selections: GiftSelectionMap;
  /** Index of the tier the customer currently qualifies for (may be null). */
  currentTierIndex: number | null;
  locked: boolean;
  /** Gifts may be skipped when `allowGiftSkipping` is on. */
  allowSkipping: boolean;
}

function resolveSlot(options: ResolveSlotOptions): ResolvedGiftSlot {
  const { promotion, tier, slotIndex, selections, locked, allowSkipping } = options;
  const slot = tier.slots[slotIndex];
  if (!slot) {
    throw new Error(`Slot ${slotIndex} missing on tier ${tier.index}`);
  }

  const key = slotSelectionKey(tier.index, slot.key);
  const pool = findPool(promotion, slot.poolKey);
  const lineKey = giftLineKey(promotion.id, tier.index, slot.key);

  const allCandidates = pool?.candidates ?? [];
  const giftable = allCandidates.filter((candidate) => isCandidateGiftable(promotion, candidate, pool));
  const inStock = giftable.filter((candidate) => candidate.stockQty > 0);

  const base: Omit<ResolvedGiftSlot, 'selected' | 'status' | 'message' | 'blocking'> = {
    key,
    slotKey: slot.key,
    tierIndex: tier.index,
    label: slot.label,
    giftType: slot.giftType,
    quantity: slot.quantity,
    poolKey: slot.poolKey,
    poolLabel: pool?.label ?? slot.label,
    candidates: giftable,
    locked,
    lineKey,
  };

  const selection: GiftSelection | undefined = selections[key];

  if (selection) {
    const candidate = giftable.find(
      (item) => item.productId === selection.productId && item.variantId === selection.variantId,
    );

    if (!candidate) {
      // §17/§19 — the product is no longer gift-eligible (admin changed the
      // pool, or the customer got a stale cart). It must be replaced.
      return {
        ...base,
        selected: null,
        status: 'INELIGIBLE_SELECTION',
        message: GIFT_MESSAGES.noLongerInPromotion,
        blocking: true,
      };
    }

    if (candidate.stockQty <= 0) {
      return {
        ...base,
        selected: null,
        status: 'OUT_OF_STOCK',
        message: GIFT_MESSAGES.unavailable,
        blocking: true,
      };
    }

    return {
      ...base,
      selected: { ...selection, candidate },
      status: 'SELECTED',
      message: null,
      blocking: false,
    };
  }

  if (inStock.length === 0) {
    return {
      ...base,
      selected: null,
      status: 'UNAVAILABLE',
      message: GIFT_MESSAGES.soldOutPool,
      // Not blocking: an empty pool is the store's problem, not the shopper's.
      blocking: false,
    };
  }

  return {
    ...base,
    selected: null,
    status: 'NEEDS_SELECTION',
    message: GIFT_MESSAGES.choose(slot.label),
    blocking: !allowSkipping && promotion.requireGiftSelection,
  };
}

/**
 * Evaluates one promotion against a cart. Pure — same inputs always produce the
 * same output, so it is safe to call from the cart page, checkout and admin
 * preview alike.
 */
export function evaluatePromotion(input: EvaluatePromotionInput): PromotionEvaluation {
  const { promotion, lines, selections, now } = input;
  const inactiveReason = isPromotionLive(promotion, now);
  const { count, quantity, lineKeys } = countEligibleItems(promotion, lines);
  const currentTierIndex = resolveTierIndex(promotion, count);

  const emptyEvaluation: PromotionEvaluation = {
    promotionId: promotion.id,
    promotionSlug: promotion.slug,
    promotionName: promotion.name,
    active: false,
    inactiveReason,
    eligibleCount: count,
    eligibleLineKeys: lineKeys,
    eligibleQuantity: quantity,
    currentTierIndex: null,
    currentTier: null,
    previousTier: null,
    nextTier: null,
    tiers: promotion.tiers.map((tier) => toEvaluatedTier(tier, currentTierIndex, [], count)),
    slots: [],
    grantedGifts: [],
    giftValueMinor: 0,
    giftCount: 0,
    warnings: [],
    errors: [],
    lockedApplied: false,
    grantedTierIndex: input.grantedTierIndex ?? null,
  };

  if (inactiveReason) return emptyEvaluation;

  // ---------------------------------------------------------------------
  // §20 Gift locking
  // ---------------------------------------------------------------------
  const warnings: string[] = [];
  const grantedTierIndex = input.grantedTierIndex ?? null;
  let lockedApplied = false;
  let grantedIndexes: number[] = currentTierIndex === null ? [] : [currentTierIndex];

  const floor = qualifyingFloor(promotion);
  const canLock =
    promotion.lockGrantedGifts &&
    grantedTierIndex !== null &&
    tierByIndex(promotion, grantedTierIndex) !== null &&
    count >= floor;

  if (canLock && grantedTierIndex !== null) {
    const grantedTier = tierByIndex(promotion, grantedTierIndex);
    if (grantedTier) {
      if (promotion.lockBehavior === 'HIGHEST_ONLY') {
        grantedIndexes = currentTierIndex !== null ? [Math.max(currentTierIndex, grantedTierIndex)] : [grantedTierIndex];
      } else {
        grantedIndexes = Array.from(new Set([...grantedIndexes, grantedTierIndex])).sort((a, b) => a - b);
      }
      lockedApplied = grantedTierIndex > (currentTierIndex ?? -1);
      if (lockedApplied) warnings.push(GIFT_MESSAGES.lockedKept);
    }
  } else if (promotion.lockGrantedGifts && grantedTierIndex !== null && count < floor && count >= 0) {
    /* Cart dropped below every tier: even a locked gift is revoked (§20 — a locked gift must
       still be validated for promotion validity).
       The body used to be wrapped in a second `if (grantedTierIndex !== null && count < floor)`
       re-testing two conditions this branch was only entered because they held, so the guard
       could never be false — dead code that made the revocation look conditional when it is
       not. Behaviour is unchanged; the warning now fires exactly where it always did. */
    warnings.push('Your cart no longer qualifies for the free gift offer.');
  }

  if (grantedIndexes.length === 0) {
    // Nothing qualifies yet — still report full tier progress so the storefront
    // can render "add 2 more to unlock…".
    const tiersWithoutGifts = promotion.tiers
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((tier) => toEvaluatedTier(tier, currentTierIndex, [], count));
    const next = tiersWithoutGifts.find((tier) => currentTierIndex === null || tier.index > currentTierIndex) ?? null;
    const previous =
      [...tiersWithoutGifts].reverse().find((tier) => currentTierIndex !== null && tier.index < currentTierIndex) ?? null;

    return {
      ...emptyEvaluation,
      active: true,
      warnings,
      tiers: tiersWithoutGifts,
      previousTier: previous ? { index: previous.index, label: previous.label } : null,
      nextTier: next,
      grantedTierIndex: null,
    };
  }

  // ---------------------------------------------------------------------
  // Resolve gift slots for every granted tier
  // ---------------------------------------------------------------------
  const slots: ResolvedGiftSlot[] = [];
  const grantedTiers = grantedIndexes
    .map((index) => tierByIndex(promotion, index))
    .filter((tier): tier is EngineTier => tier !== null)
    .sort((a, b) => a.index - b.index);

  const seenSlotKeys = new Set<string>();
  for (const tier of grantedTiers) {
    const isLockedTier = lockedApplied && currentTierIndex !== tier.index;
    for (let slotIndex = 0; slotIndex < tier.slots.length; slotIndex += 1) {
      const resolved = resolveSlot({
        promotion,
        tier,
        slotIndex,
        selections,
        currentTierIndex,
        locked: isLockedTier,
        allowSkipping: promotion.allowGiftSkipping,
      });
      // KEEP_ALL can surface the same slot key on two tiers — grant it once.
      if (seenSlotKeys.has(resolved.slotKey)) continue;
      seenSlotKeys.add(resolved.slotKey);
      slots.push(resolved);
    }
  }

  // ---------------------------------------------------------------------
  // Aggregate
  // ---------------------------------------------------------------------
  const maxGifts = promotion.maxGiftsPerOrder;
  let giftCount = 0;
  const errors: string[] = [];

  const grantedGifts: PromotionEvaluation['grantedGifts'] = [];
  let giftValueMinor = 0;

  for (const slot of slots) {
    if (slot.status === 'SELECTED' && slot.selected) {
      const candidate = slot.selected.candidate;
      const exceedsCap = maxGifts !== null && giftCount + slot.quantity > maxGifts;
      if (exceedsCap) {
        warnings.push(`Only ${maxGifts} free gift(s) can be added per order.`);
        continue;
      }
      giftCount += slot.quantity;
      giftValueMinor += mulMinor(candidate.priceMinor, slot.quantity);
      grantedGifts.push({
        slotKey: slot.slotKey,
        lineKey: slot.lineKey,
        tierIndex: slot.tierIndex,
        giftType: slot.giftType,
        label: slot.label,
        quantity: slot.quantity,
        productId: candidate.productId,
        variantId: candidate.variantId,
        valueMinor: mulMinor(candidate.priceMinor, slot.quantity),
      });
    } else if (slot.blocking) {
      errors.push(slot.message ?? GIFT_MESSAGES.unavailable);
    } else if (slot.status === 'UNAVAILABLE') {
      warnings.push(slot.message ?? GIFT_MESSAGES.soldOutPool);
    }
  }

  const evaluatedTiers = promotion.tiers
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((tier) => toEvaluatedTier(tier, currentTierIndex, grantedIndexes, count));
  const currentTier = evaluatedTiers.find((tier) => tier.index === currentTierIndex) ?? null;
  const previousTier = [...evaluatedTiers].reverse().find((tier) => currentTierIndex !== null && tier.index < currentTierIndex) ?? null;
  const nextTier = evaluatedTiers.find((tier) => currentTierIndex === null || tier.index > currentTierIndex) ?? null;

  return {
    promotionId: promotion.id,
    promotionSlug: promotion.slug,
    promotionName: promotion.name,
    active: true,
    inactiveReason: null,
    eligibleCount: count,
    eligibleLineKeys: lineKeys,
    eligibleQuantity: quantity,
    currentTierIndex,
    currentTier,
    previousTier: previousTier ? { index: previousTier.index, label: previousTier.label } : null,
    nextTier,
    tiers: evaluatedTiers,
    slots,
    grantedGifts,
    giftValueMinor,
    giftCount,
    warnings,
    errors,
    lockedApplied,
    // Remember the highest tier ever reached so "Lock Granted Gifts" can work.
    grantedTierIndex: Math.max(grantedTierIndex ?? -1, currentTierIndex ?? -1) >= 0
      ? Math.max(grantedTierIndex ?? -1, currentTierIndex ?? -1)
      : null,
  };
}

/**
 * Non-gift promotions (PERCENTAGE / FIXED / BUY_X_GET_Y) — pure discount math,
 * also used at checkout. Amounts are minor units throughout.
 */
export interface DiscountLine {
  productId: string;
  categoryId: string;
  unitPriceMinor: number;
  quantity: number;
}

export interface PromotionDiscountResult {
  discountMinor: number;
  label: string;
  reason: string | null;
}

export function calculatePromotionDiscount(
  promotion: EnginePromotion,
  lines: DiscountLine[],
  now: Date,
): PromotionDiscountResult {
  const inactive = isPromotionLive(promotion, now);
  const scopedLines = lines.filter((line) => {
    const asCartLine: EngineCartLine = {
      lineKey: '',
      productId: line.productId,
      variantId: '',
      categoryId: line.categoryId,
      quantity: line.quantity,
      isGift: false,
      promotionId: null,
      promotionTierIndex: null,
      giftSlotKey: null,
    };
    return isEligiblePurchaseLine(promotion, asCartLine);
  });

  /* mulMinor/sumMinor rather than raw `*` and `+`: they assert the integers this module's
     whole design rests on, so a non-integer unit price arriving from a corrupt row fails
     loudly here instead of quietly producing a fractional discount that a later
     assertMinor() rejects with no clue where it came from. */
  const subtotal = sumMinor(scopedLines.map((line) => mulMinor(line.unitPriceMinor, line.quantity)));

  if (inactive) return { discountMinor: 0, label: promotion.name, reason: inactive };
  if (subtotal <= 0) return { discountMinor: 0, label: promotion.name, reason: 'NOTHING_ELIGIBLE' };

  switch (promotion.type) {
    case 'PERCENTAGE': {
      const percent = promotion.config.percentOff ?? 0;
      /* Was inlined as `Math.round((subtotal * Math.round(percent * 100)) / 10_000)` —
         character-for-character the body of percentOfMinor(). lib/money.ts is documented as
         the single authoritative implementation of currency arithmetic, so a second copy
         here is one that can drift (it already lacked the integer assert). */
      return { discountMinor: Math.min(percentOfMinor(subtotal, percent), subtotal), label: promotion.name, reason: null };
    }
    case 'FIXED': {
      const amount = promotion.config.amountOffMinor ?? 0;
      return { discountMinor: Math.min(amount, subtotal), label: promotion.name, reason: null };
    }
    case 'BUY_X_GET_Y': {
      const buy = promotion.config.buyQuantity ?? 0;
      const get = promotion.config.getQuantity ?? 0;
      if (buy <= 0 || get <= 0) return { discountMinor: 0, label: promotion.name, reason: 'NOT_CONFIGURED' };
      const units = scopedLines.reduce((total, line) => total + line.quantity, 0);
      const groups = Math.floor(units / (buy + get));
      if (groups <= 0) return { discountMinor: 0, label: promotion.name, reason: 'THRESHOLD_NOT_MET' };
      /* Cheapest units are free. The comment here used to call that "the customer-favourable
         reading", which is backwards and worth correcting because someone will otherwise
         "fix" the code to match it: giving away the CHEAPEST units is the MERCHANT-favourable
         choice, and it is also retail standard for buy-N-get-N offers. The customer-favourable
         variant would sort descending and give away the most expensive units. The behaviour is
         correct as written; only the comment was wrong. */
      const unitPrices = scopedLines
        .flatMap((line) => Array.from({ length: line.quantity }, () => line.unitPriceMinor))
        .sort((a, b) => a - b);
      const freeUnits = unitPrices.slice(0, groups * get);
      const discount = sumMinor(freeUnits);
      return { discountMinor: Math.min(discount, subtotal), label: promotion.name, reason: null };
    }
    default:
      return { discountMinor: 0, label: promotion.name, reason: 'NOT_A_DISCOUNT_PROMOTION' };
  }
}

/**
 * Validates a shopper's explicit gift choice before it is written to the cart.
 * Returns null when the choice is acceptable, otherwise a shopper-facing message.
 */
export function validateGiftChoice(
  promotion: EnginePromotion,
  tierIndex: number,
  slotKey: string,
  candidate: { productId: string; variantId: string },
  pools: EngineGiftPool[],
  now: Date,
): string | null {
  if (isPromotionLive(promotion, now)) return 'This offer is no longer available.';

  const tier = promotion.tiers.find((item) => item.index === tierIndex);
  if (!tier) return 'That offer tier no longer exists.';

  const slot = tier.slots.find((item) => item.key === slotKey);
  if (!slot) return 'That gift slot is no longer part of this offer.';

  const pool = pools.find((item) => item.key === slot.poolKey);
  if (!pool) return 'That gift pool is no longer available.';

  const match = pool.candidates.find(
    (item) => item.productId === candidate.productId && item.variantId === candidate.variantId,
  );
  if (!match) return GIFT_MESSAGES.noLongerInPromotion;
  if (!isCandidateGiftable(promotion, match, pool)) return GIFT_MESSAGES.noLongerInPromotion;
  if (match.stockQty <= 0) return GIFT_MESSAGES.unavailable;

  return null;
}
