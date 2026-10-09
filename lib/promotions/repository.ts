/**
 * PROMOTIONS — repository
 *
 * The engine (engine.ts) is pure and knows nothing about Prisma. This file is
 * the only place that turns the admin-authored tables into an `EnginePromotion`.
 *
 * Two details of THIS repo differ from the engine's origin repo, and both are
 * handled here so the engine stays untouched:
 *   · ids are Int (autoincrement) → stringified for the engine's string ids
 *   · money is a Float in taka → converted to integer minor units (poisha)
 */
import { db } from "@/lib/db";
import { toMinorSafe } from "@/lib/money";
import type {
  EngineGiftPool,
  EnginePromotion,
  EngineTier,
  GiftCandidate,
} from "./types";

/* Taka (Float) → poisha (integer). Money is never a float past this line. */
export const toMinor = toMinorSafe;

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
};

type PoolProductRow = {
  variantIds: string;
  product: {
    id: number;
    slug: string;
    title: string;
    sku: string | null;
    price: number;
    comparePrice: number | null;
    status: string;
    images: { url: string }[];
    variants: {
      id: number;
      size: string | null;
      color: string | null;
      sku: string | null;
      price: number | null;
      stock: number;
      image: string | null;
    }[];
  };
};

/** One row of a gift pool → the engine's candidate list (one entry per variant). */
function toCandidates(row: PoolProductRow): GiftCandidate[] {
  const p = row.product;
  const only = parseJson<number[]>(row.variantIds, []).map(Number).filter(Number.isFinite);
  const variants = only.length ? p.variants.filter((v) => only.includes(v.id)) : p.variants;
  const productActive = p.status === "ACTIVE";

  return variants.map((v) => {
    const label = [v.size, v.color].filter(Boolean).join(" / ");
    return {
      productId: String(p.id),
      variantId: String(v.id),
      productSlug: p.slug,
      productName: p.title,
      sku: v.sku || p.sku || "",
      variantLabel: label || "One size",
      colorName: v.color ?? null,
      priceMinor: toMinor(v.price ?? p.price),
      compareAtMinor: p.comparePrice != null ? toMinor(p.comparePrice) : null,
      imageUrl: v.image || p.images?.[0]?.url || null,
      stockQty: v.stock,
      /** Shown in the picker but not selectable when the variant is gone. */
      selectable: productActive && v.stock > 0,
    };
  });
}

/**
 * Products that join a pool because of its category auto-fill. One query for the
 * whole promotion; returns rows shaped exactly like PromotionGiftProduct rows so
 * `toCandidates` can treat them identically.
 */
async function loadAutoFillRows(p: any): Promise<Map<string, PoolProductRow[]>> {
  const byPool = new Map<string, PoolProductRow[]>();
  const pools = (p.giftPools || []).filter((pool: any) => pool.autoFill);
  if (!pools.length) return byPool;

  const wanted = new Set<number>(
    pools.flatMap((pool: any) => parseJson<number[]>(pool.categoryIds, []).map(Number)).filter(Number.isFinite),
  );
  if (!wanted.size) return byPool;

  const products = await db.product.findMany({
    where: { status: "ACTIVE", categoryId: { in: [...wanted] } },
    include: {
      images: { orderBy: { position: "asc" }, take: 1 },
      variants: { orderBy: { id: "asc" } },
    },
    orderBy: { id: "asc" },
  });

  for (const pool of pools) {
    const cats = new Set(parseJson<number[]>(pool.categoryIds, []).map(Number));
    byPool.set(
      pool.id,
      products.filter((prod) => prod.categoryId != null && cats.has(prod.categoryId)).map((product) => ({ variantIds: "[]", product })),
    );
  }
  return byPool;
}

export function toEnginePromotion(p: any, autoRows?: Map<string, PoolProductRow[]>): EnginePromotion {
  const poolsById = new Map<string, EngineGiftPool>();
  const pools: EngineGiftPool[] = (p.giftPools || []).map((pool: any) => {
    const handPicked = (pool.products || []).flatMap(toCandidates);
    const seen = new Set(handPicked.map((c) => c.variantId));
    const auto = (autoRows?.get(pool.id) || []).flatMap(toCandidates).filter((c) => !seen.has(c.variantId));
    const enginePool: EngineGiftPool = {
      id: pool.id,
      key: pool.key,
      label: pool.label,
      description: pool.description ?? null,
      candidates: [...handPicked, ...auto],
      excludeProductIds: parseJson<number[]>(pool.excludeProductIds, []).map(String),
    };
    poolsById.set(pool.id, enginePool);
    return enginePool;
  });

  const tiers: EngineTier[] = (p.tiers || []).map((tier: any) => ({
    index: tier.index,
    key: tier.key,
    label: tier.label,
    description: tier.description ?? null,
    requiredQuantity: tier.requiredQuantity,
    slots: (tier.slots || []).map((slot: any) => ({
      key: slot.key,
      label: slot.label,
      giftType: slot.giftType,
      quantity: slot.quantity,
      poolKey: slot.giftPool?.key ?? poolsById.get(slot.giftPoolId)?.key ?? "",
    })),
  }));

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? null,
    type: p.type,
    status: p.status,
    priority: p.priority,
    startsAt: p.startsAt,
    endsAt: p.endsAt ?? null,
    countMode: p.countMode,
    eligibilityScope: p.eligibilityScope,
    highestTierWins: p.highestTierWins,
    lockGrantedGifts: p.lockGrantedGifts,
    lockBehavior: p.lockBehavior,
    requireGiftSelection: p.requireGiftSelection,
    allowGiftSkipping: p.allowGiftSkipping,
    maxGiftsPerOrder: p.maxGiftsPerOrder ?? null,
    maxOrders: p.maxOrders ?? null,
    usedOrders: p.usedOrders,
    config: parseJson<Record<string, number>>(p.config, {}),
    eligibleProductIds: (p.eligibleProducts || []).map((r: any) => String(r.productId)),
    excludedProductIds: (p.excludedProducts || []).map((r: any) => String(r.productId)),
    eligibleCategoryIds: (p.eligibleCategories || []).map((r: any) => String(r.categoryId)),
    excludedCategoryIds: (p.excludedCategories || []).map((r: any) => String(r.categoryId)),
    excludedGiftProductIds: (p.excludedGiftItems || []).map((r: any) => String(r.productId)),
    tiers,
    giftPools: pools,
  } as EnginePromotion;
}

const PROMOTION_INCLUDE = {
  tiers: {
    orderBy: { sortOrder: "asc" as const },
    include: { slots: { orderBy: { sortOrder: "asc" as const }, include: { giftPool: true } } },
  },
  giftPools: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" as const },
        include: {
          product: {
            include: {
              images: { orderBy: { position: "asc" as const }, take: 1 },
              variants: { orderBy: { id: "asc" as const } },
            },
          },
        },
      },
    },
  },
  eligibleProducts: true,
  excludedProducts: true,
  eligibleCategories: true,
  excludedCategories: true,
  excludedGiftItems: true,
};

/** The live promotion the storefront should show, or null when none is running. */
export async function loadActivePromotion(now = new Date()): Promise<EnginePromotion | null> {
  const row = await db.promotion.findFirst({
    where: {
      type: "GIFT_TIERS",
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    include: PROMOTION_INCLUDE,
  });
  if (!row) return null;
  return toEnginePromotion(row, await loadAutoFillRows(row));
}

/** Any promotion by id — used by the admin editor (drafts included). */
export async function loadPromotionById(id: string) {
  const row = await db.promotion.findUnique({ where: { id }, include: PROMOTION_INCLUDE });
  if (!row) return null;
  return { row, engine: toEnginePromotion(row, await loadAutoFillRows(row)) };
}
