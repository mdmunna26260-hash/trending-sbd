/**
 * PROMOTION ENGINE — types
 *
 * These types are deliberately free of any Prisma/database dependency so the
 * engine can be unit-tested in isolation (§23: "independently testable") and
 * reused by the cart service, the checkout transaction and the admin preview.
 */

export type PromotionType = 'GIFT_TIERS' | 'PERCENTAGE' | 'FIXED' | 'BUY_X_GET_Y';
export type PromotionStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
export type CountMode = 'QUANTITY' | 'DISTINCT_LINES';
export type EligibilityScope = 'ALL_PRODUCTS' | 'PRODUCTS' | 'CATEGORIES';
export type LockBehavior = 'KEEP_ALL' | 'HIGHEST_ONLY';

/** A single buyable variant of a product, as known to the engine. */
export interface EngineVariant {
  id: string;
  productId: string;
  size: string;
  colorName: string | null;
  stockQty: number;
  isActive: boolean;
}

/** A product the engine may reason about (name/price only — no business logic). */
export interface EngineProduct {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  priceMinor: number;
  compareAtMinor: number | null;
  sku: string;
  isGiftEligible: boolean;
  imageUrl: string | null;
}

/** One entry of an admin-configured gift pool, already resolved to a variant. */
export interface GiftCandidate {
  productId: string;
  variantId: string;
  productSlug: string;
  productName: string;
  sku: string;
  variantLabel: string;
  colorName: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  imageUrl: string | null;
  stockQty: number;
  /** False when the variant is inactive — candidate is shown but not selectable. */
  selectable: boolean;
}

export interface EngineGiftPool {
  id: string;
  key: string;
  label: string;
  description: string | null;
  candidates: GiftCandidate[];
  /** Per-rule exclusion: ei pool-e ei product gulo kokhono gift hobe na — hand-picked ba
      category auto-fill, dutoi theke bad pore. (Promotion-level `excludedGiftProductIds`
      global; eta tar pool-scoped version.) */
  excludeProductIds: string[];
}

export interface EngineTierSlot {
  key: string;
  label: string;
  giftType: string;
  quantity: number;
  poolKey: string;
}

export interface EngineTier {
  index: number;
  key: string;
  label: string;
  description: string | null;
  requiredQuantity: number;
  slots: EngineTierSlot[];
}

/** Fully-resolved promotion. Everything the engine needs, nothing more. */
export interface EnginePromotion {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: PromotionType;
  status: PromotionStatus;
  priority: number;
  startsAt: Date;
  endsAt: Date | null;
  countMode: CountMode;
  eligibilityScope: EligibilityScope;
  highestTierWins: boolean;
  lockGrantedGifts: boolean;
  lockBehavior: LockBehavior;
  requireGiftSelection: boolean;
  allowGiftSkipping: boolean;
  maxGiftsPerOrder: number | null;
  maxOrders: number | null;
  usedOrders: number;
  /** Explicit free-form params for PERCENTAGE / FIXED / BUY_X_GET_Y promotions. */
  config: { percentOff?: number; amountOffMinor?: number; buyQuantity?: number; getQuantity?: number };
  eligibleProductIds: string[];
  excludedProductIds: string[];
  eligibleCategoryIds: string[];
  excludedCategoryIds: string[];
  /** Products that may be purchased but never handed out as a gift (§17). */
  excludedGiftProductIds: string[];
  tiers: EngineTier[];
  giftPools: EngineGiftPool[];
}

/** A cart line as seen by the engine. */
export interface EngineCartLine {
  lineKey: string;
  productId: string;
  variantId: string;
  categoryId: string;
  quantity: number;
  isGift: boolean;
  promotionId: string | null;
  promotionTierIndex: number | null;
  giftSlotKey: string | null;
}

export interface GiftSelection {
  productId: string;
  variantId: string;
}

/** `slotKey` -> selection. Persisted on the cart so it survives requests. */
export type GiftSelectionMap = Record<string, GiftSelection>;

export type PromotionInactiveReason =
  | 'NOT_STARTED'
  | 'ENDED'
  | 'PAUSED'
  | 'DRAFT'
  | 'ORDER_LIMIT_REACHED'
  | 'NO_TIERS';

export type GiftSlotStatus =
  | 'SELECTED'
  | 'NEEDS_SELECTION'
  | 'UNAVAILABLE'
  /** Selected gift is not in the pool / excluded / variant gone. */
  | 'INELIGIBLE_SELECTION'
  /** Selected gift variant has no stock left. */
  | 'OUT_OF_STOCK';

export interface ResolvedGiftSlot {
  /** `<tierIndex>:<slotKey>` — unique within a promotion. */
  key: string;
  slotKey: string;
  tierIndex: number;
  label: string;
  giftType: string;
  quantity: number;
  poolKey: string;
  poolLabel: string;
  selected: (GiftSelection & { candidate: GiftCandidate }) | null;
  candidates: GiftCandidate[];
  status: GiftSlotStatus;
  /** Human, shopper-facing explanation for non-SELECTED statuses. */
  message: string | null;
  /** True when this slot blocks checkout until resolved. */
  blocking: boolean;
  locked: boolean;
  lineKey: string;
}

export interface EvaluatedTier {
  index: number;
  key: string;
  label: string;
  requiredQuantity: number;
  /** How many more eligible items are needed to unlock this tier. */
  quantityToGo: number;
  unlocked: boolean;
  isCurrent: boolean;
  /** True when this tier's gifts are being granted (current or locked). */
  isGranted: boolean;
  slots: Array<{ key: string; label: string; giftType: string; quantity: number }>;
}

export interface PromotionEvaluation {
  promotionId: string;
  promotionSlug: string;
  promotionName: string;
  active: boolean;
  inactiveReason: PromotionInactiveReason | null;
  /** Eligible item count as defined by `countMode`. */
  eligibleCount: number;
  eligibleLineKeys: string[];
  /** Eligible units that are *paid* items (gift lines never count). */
  eligibleQuantity: number;
  currentTierIndex: number | null;
  currentTier: EvaluatedTier | null;
  previousTier: { index: number; label: string } | null;
  nextTier: EvaluatedTier | null;
  tiers: EvaluatedTier[];
  slots: ResolvedGiftSlot[];
  /** Convenience: every slot that will actually be handed over right now. */
  grantedGifts: Array<{
    slotKey: string;
    lineKey: string;
    tierIndex: number;
    giftType: string;
    label: string;
    quantity: number;
    productId: string;
    variantId: string;
    valueMinor: number;
  }>;
  giftValueMinor: number;
  giftCount: number;
  /** Non-blocking advisories shown in the cart. */
  warnings: string[];
  /** Blocking problems that must be fixed before checkout. */
  errors: string[];
  lockedApplied: boolean;
  /** Tier index that should be remembered on the cart ("highest ever granted"). */
  grantedTierIndex: number | null;
}

export interface EvaluatePromotionInput {
  promotion: EnginePromotion;
  lines: EngineCartLine[];
  selections: GiftSelectionMap;
  now: Date;
  /** Highest tier index this cart has ever been granted (for gift locking). */
  grantedTierIndex?: number | null;
}
