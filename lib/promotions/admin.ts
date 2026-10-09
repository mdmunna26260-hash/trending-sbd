/**
 * PROMOTIONS — admin layer
 *
 * Everything the /admin/promotions workbench needs, kept out of the routes:
 *   listPromotions / getPromotionDraft / savePromotion / deletePromotion
 *   catalog()        → products + categories for the pickers
 *   previewDraft()   → run the REAL engine against an unsaved draft
 *
 * The editor works on a plain JSON "draft" (no Prisma types), so the same shape
 * travels client → API → engine preview → database.
 */
import { db } from "@/lib/db";
import { toEnginePromotion } from "./repository";
import { evaluateCart, toComboView, giftLinesToDrop, type StoreCartLine } from "./service";
import type { EnginePromotion, GiftSelectionMap } from "./types";

/* ------------------------------------------------------------------ types */

export type DraftPool = {
  key: string;
  label: string;
  description?: string | null;
  /** Every ACTIVE product of `categoryIds` joins the candidate list. */
  autoFill: boolean;
  categoryIds: number[];
  /** Per-rule exclusion: ei pool theke ei product gulo bad (hand-picked + auto-fill dutoi theke). */
  excludeProductIds: number[];
  /** Hand-picked rows. Empty `variantIds` = every variant of the product. */
  products: { productId: number; variantIds: number[] }[];
};

export type DraftTier = {
  index: number;
  key: string;
  label: string;
  description?: string | null;
  requiredQuantity: number;
  slots: { key: string; label: string; poolKey: string; giftType: string; quantity: number }[];
};

export type PromotionDraft = {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
  priority: number;
  startsAt?: string | null;
  endsAt?: string | null;
  countMode: "QUANTITY" | "DISTINCT_LINES";
  eligibilityScope: "ALL_PRODUCTS" | "PRODUCTS" | "CATEGORIES";
  highestTierWins: boolean;
  lockGrantedGifts: boolean;
  requireGiftSelection: boolean;
  allowGiftSkipping: boolean;
  maxGiftsPerOrder?: number | null;
  maxOrders?: number | null;
  eligibleProductIds: number[];
  excludedProductIds: number[];
  eligibleCategoryIds: number[];
  excludedCategoryIds: number[];
  excludedGiftProductIds: number[];
  pools: DraftPool[];
  tiers: DraftTier[];
};

export const GIFT_TYPES = ["SHIRT", "T_SHIRT", "PANTS", "DENIM", "DRESS", "BAG", "FOOTWEAR", "ACCESSORY", "CUSTOM"] as const;

/* ------------------------------------------------------------- row shapes */

const PRODUCT_ROW = {
  id: true, slug: true, title: true, sku: true, price: true, comparePrice: true,
  stock: true, status: true, categoryId: true,
  images: { orderBy: { position: "asc" as const }, take: 1 },
  variants: { orderBy: { id: "asc" as const } },
};

const ADMIN_INCLUDE = {
  tiers: {
    orderBy: { sortOrder: "asc" as const },
    include: { slots: { orderBy: { sortOrder: "asc" as const }, include: { giftPool: { select: { key: true, id: true } } } } },
  },
  giftPools: {
    orderBy: { sortOrder: "asc" as const },
    include: { products: { orderBy: { sortOrder: "asc" as const }, select: { productId: true, variantIds: true } } },
  },
  eligibleProducts: { select: { productId: true } },
  excludedProducts: { select: { productId: true } },
  eligibleCategories: { select: { categoryId: true } },
  excludedCategories: { select: { categoryId: true } },
  excludedGiftItems: { select: { productId: true } },
  _count: { select: { usages: true } },
};

const asIds = (rows: { productId: number }[] | undefined) => (rows || []).map((r) => r.productId);
const asCatIds = (rows: { categoryId: number }[] | undefined) => (rows || []).map((r) => r.categoryId);

/* ---------------------------------------------------------------- reading */

export async function listPromotions() {
  const rows = await db.promotion.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    include: {
      tiers: { orderBy: { sortOrder: "asc" }, select: { index: true, label: true, requiredQuantity: true, slots: { select: { key: true } } } },
      giftPools: { select: { key: true, autoFill: true, _count: { select: { products: true } } } },
      _count: { select: { usages: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, description: p.description, status: p.status,
    priority: p.priority, startsAt: p.startsAt, endsAt: p.endsAt,
    usedOrders: p.usedOrders, maxOrders: p.maxOrders, usageRows: p._count.usages,
    updatedAt: p.updatedAt,
    tiers: p.tiers.map((t) => ({ index: t.index, label: t.label, requiredQuantity: t.requiredQuantity, slotCount: t.slots.length })),
    pools: p.giftPools.map((g) => ({ key: g.key, autoFill: g.autoFill, productCount: g._count.products })),
  }));
}

export async function getPromotionDraft(id: string): Promise<PromotionDraft | null> {
  const p = await db.promotion.findUnique({ where: { id }, include: ADMIN_INCLUDE });
  if (!p) return null;
  const parseVariantIds = (raw: string): number[] => {
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []; } catch { return []; }
  };
  return {
    id: p.id,
    name: p.name, slug: p.slug, description: p.description,
    status: p.status as PromotionDraft["status"], priority: p.priority,
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
    countMode: p.countMode as PromotionDraft["countMode"],
    eligibilityScope: p.eligibilityScope as PromotionDraft["eligibilityScope"],
    highestTierWins: p.highestTierWins, lockGrantedGifts: p.lockGrantedGifts,
    requireGiftSelection: p.requireGiftSelection, allowGiftSkipping: p.allowGiftSkipping,
    maxGiftsPerOrder: p.maxGiftsPerOrder, maxOrders: p.maxOrders,
    eligibleProductIds: asIds(p.eligibleProducts),
    excludedProductIds: asIds(p.excludedProducts),
    eligibleCategoryIds: asCatIds(p.eligibleCategories),
    excludedCategoryIds: asCatIds(p.excludedCategories),
    excludedGiftProductIds: asIds(p.excludedGiftItems),
    pools: p.giftPools.map((pool) => ({
      key: pool.key, label: pool.label, description: pool.description, autoFill: pool.autoFill,
      categoryIds: parseVariantIds(pool.categoryIds),
      excludeProductIds: parseVariantIds(pool.excludeProductIds),
      products: pool.products.map((row) => ({ productId: row.productId, variantIds: parseVariantIds(row.variantIds) })),
    })),
    tiers: p.tiers.map((t) => ({
      index: t.index, key: t.key, label: t.label, description: t.description, requiredQuantity: t.requiredQuantity,
      slots: t.slots.map((s) => ({ key: s.key, label: s.label, poolKey: s.giftPool?.key || "", giftType: s.giftType, quantity: s.quantity })),
    })),
  };
}

export async function catalog() {
  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { title: "asc" },
      select: {
        id: true, title: true, slug: true, price: true, stock: true, categoryId: true,
        images: { orderBy: { position: "asc" }, take: 1 },
        variants: { select: { id: true, size: true, color: true, stock: true }, orderBy: { id: "asc" } },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { products: true } } } }),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id, title: p.title, slug: p.slug, price: p.price, stock: p.stock, categoryId: p.categoryId,
      image: p.images[0]?.url ?? null,
      variantCount: p.variants.length,
      variants: p.variants,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, productCount: c._count.products })),
  };
}

/* -------------------------------------------------------------- validation */

export function validateDraft(d: PromotionDraft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!d.name?.trim()) errors.push("Name is required");
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(d.slug || "")) errors.push("Slug must be lowercase letters, numbers and dashes (2–60 chars)");
  if (!d.tiers?.length) errors.push("At least one tier is required");

  const poolKeys = new Set<string>();
  for (const pool of d.pools || []) {
    if (!pool.key?.trim()) errors.push("Every gift pool needs a key");
    if (poolKeys.has(pool.key)) errors.push(`Duplicate pool key "${pool.key}"`);
    poolKeys.add(pool.key);
    if (pool.autoFill && !pool.categoryIds?.length) warnings.push(`Pool "${pool.label || pool.key}" has auto-fill on but no categories picked`);
    if (!pool.autoFill && !pool.products?.length) warnings.push(`Pool "${pool.label || pool.key}" has no products — its free gifts will show as out of stock`);
    /* Per-rule exclusion sanity: excluded id gulo jodi pool er kono product er sathe na mile,
       tahole owner bhul list boshate paren — take chupchap ignore na kore bole dei. */
    const handIds = (pool.products || []).map((row) => Number(row.productId));
    const excludedIds = (pool.excludeProductIds || []).map(Number).filter(Number.isFinite);
    const hit = handIds.filter((id) => excludedIds.includes(id));
    if (excludedIds.length && !pool.autoFill && !hit.length) {
      warnings.push(`Pool "${pool.label || pool.key}": exclude list er kono product hand-picked list e nei — auto-fill category theke asle tabe kaj korbe`);
    } else if (hit.length && !pool.autoFill && hit.length === handIds.length) {
      warnings.push(`Pool "${pool.label || pool.key}": hand-picked product gulo sob excluded — ei pool e kono gift nei`);
    } else if (hit.length) {
      warnings.push(`Pool "${pool.label || pool.key}": ${hit.length} hand-picked product excluded — ogulo offer hoy na`);
    }
  }

  const tierIndexes = new Set<number>();
  const tierKeys = new Set<string>();
  for (const tier of d.tiers || []) {
    if (!Number.isInteger(tier.index) || tier.index < 1) errors.push("Tier numbers must be whole numbers starting at 1");
    if (tierIndexes.has(tier.index)) errors.push(`Duplicate tier number ${tier.index}`);
    tierIndexes.add(tier.index);
    if (!tier.key?.trim()) errors.push(`Tier ${tier.index} needs a key`);
    if (tierKeys.has(tier.key)) errors.push(`Duplicate tier key "${tier.key}"`);
    tierKeys.add(tier.key);
    if (!Number.isFinite(tier.requiredQuantity) || tier.requiredQuantity < 1) errors.push(`Tier ${tier.index} needs a quantity of 1 or more`);
    if (!tier.slots?.length) errors.push(`Tier ${tier.index} has no gift slots`);

    const slotKeys = new Set<string>();
    for (const slot of tier.slots || []) {
      if (!slot.key?.trim()) errors.push(`Tier ${tier.index}: a slot is missing its key`);
      if (slotKeys.has(slot.key)) errors.push(`Tier ${tier.index}: duplicate slot key "${slot.key}"`);
      slotKeys.add(slot.key);
      if (!slot.poolKey) errors.push(`Tier ${tier.index} · ${slot.label || slot.key}: no gift pool chosen`);
      else if (!poolKeys.has(slot.poolKey)) errors.push(`Tier ${tier.index} · ${slot.label || slot.key}: pool "${slot.poolKey}" does not exist`);
      if (!Number.isFinite(slot.quantity) || slot.quantity < 1) errors.push(`Tier ${tier.index} · ${slot.label || slot.key}: quantity must be 1 or more`);
    }
  }

  if (d.eligibilityScope === "PRODUCTS" && !d.eligibleProductIds?.length) warnings.push("Scope is “picked products” but the list is empty — nothing will qualify");
  if (d.eligibilityScope === "CATEGORIES" && !d.eligibleCategoryIds?.length) warnings.push("Scope is “categories” but no category is picked — nothing will qualify");

  /* Two live offers: allowed (priority decides) — say so, it is easy to forget. */
  if (d.status === "ACTIVE") {
    const ordered = (d.tiers || []).map((t) => t.requiredQuantity);
    if (ordered.length > 1 && new Set(ordered).size !== ordered.length) warnings.push("Two tiers have the same quantity — the higher tier number wins");
    if (!d.allowGiftSkipping && d.requireGiftSelection) warnings.push("Gift skipping is off and a gift is required — shoppers must pick a gift before checkout");
  }
  return { errors, warnings };
}

/* ------------------------------------------------------------------ saving */

export async function savePromotion(d: PromotionDraft, userId?: string | number | null): Promise<{ id: string } | { errors: string[] }> {
  const { errors } = validateDraft(d);
  if (errors.length) return { errors };

  const clash = await db.promotion.findUnique({ where: { slug: d.slug } });
  if (clash && clash.id !== d.id) return { errors: [`Slug "${d.slug}" is already used by "${clash.name}"`] };

  const id = await db.$transaction(async (tx) => {
    const base = {
      name: d.name.trim(),
      slug: d.slug.trim(),
      description: d.description?.trim() || null,
      type: "GIFT_TIERS",
      status: d.status,
      priority: Number.isFinite(d.priority) ? d.priority : 0,
      startsAt: d.startsAt ? new Date(d.startsAt) : new Date(),
      endsAt: d.endsAt ? new Date(d.endsAt) : null,
      countMode: d.countMode,
      eligibilityScope: d.eligibilityScope,
      highestTierWins: !!d.highestTierWins,
      lockGrantedGifts: !!d.lockGrantedGifts,
      lockBehavior: "KEEP_ALL",
      requireGiftSelection: !!d.requireGiftSelection,
      allowGiftSkipping: !!d.allowGiftSkipping,
      maxGiftsPerOrder: d.maxGiftsPerOrder ? Number(d.maxGiftsPerOrder) : null,
      maxOrders: d.maxOrders ? Number(d.maxOrders) : null,
    };

    const promotion = d.id
      ? await tx.promotion.update({ where: { id: d.id }, data: base })
      : await tx.promotion.create({ data: { ...base, createdBy: userId != null ? String(userId) : null } });
    const promotionId = promotion.id;

    /* Rebuild the whole graph — it is small, and “replace” cannot half-apply.
       Order matters: tiers first (their slots hold a Restrict FK to pools). */
    await tx.promotionTier.deleteMany({ where: { promotionId } });
    await tx.promotionGiftPool.deleteMany({ where: { promotionId } });
    await tx.promotionEligibleProduct.deleteMany({ where: { promotionId } });
    await tx.promotionExcludedProduct.deleteMany({ where: { promotionId } });
    await tx.promotionEligibleCategory.deleteMany({ where: { promotionId } });
    await tx.promotionExcludedCategory.deleteMany({ where: { promotionId } });
    await tx.promotionExcludedGiftProduct.deleteMany({ where: { promotionId } });

    const poolIdByKey = new Map<string, string>();
    for (let i = 0; i < (d.pools || []).length; i++) {
      const pool = d.pools[i];
      const created = await tx.promotionGiftPool.create({
        data: {
          promotionId, key: pool.key.trim(), label: pool.label?.trim() || pool.key, description: pool.description?.trim() || null,
          sortOrder: i, autoFill: !!pool.autoFill, categoryIds: JSON.stringify((pool.categoryIds || []).map(Number)),
          excludeProductIds: JSON.stringify((pool.excludeProductIds || []).map(Number)),
          products: {
            create: (pool.products || []).map((row, j) => ({ productId: Number(row.productId), variantIds: JSON.stringify((row.variantIds || []).map(Number)), sortOrder: j })),
          },
        },
      });
      poolIdByKey.set(pool.key, created.id);
    }

    for (let i = 0; i < (d.tiers || []).length; i++) {
      const tier = d.tiers[i];
      await tx.promotionTier.create({
        data: {
          promotionId, index: tier.index, key: tier.key.trim(), label: tier.label?.trim() || tier.key,
          description: tier.description?.trim() || null, requiredQuantity: Math.max(1, Math.round(tier.requiredQuantity)), sortOrder: i,
          slots: {
            create: (tier.slots || []).map((slot, j) => ({
              giftPoolId: poolIdByKey.get(slot.poolKey)!, key: slot.key.trim(), label: slot.label?.trim() || slot.key,
              giftType: slot.giftType || "CUSTOM", quantity: Math.max(1, Math.round(slot.quantity || 1)), sortOrder: j,
            })),
          },
        },
      });
    }

    const linkSets: [("promotionEligibleProduct" | "promotionExcludedProduct" | "promotionExcludedGiftProduct"), number[]][] = [
      ["promotionEligibleProduct", d.eligibleProductIds || []],
      ["promotionExcludedProduct", d.excludedProductIds || []],
      ["promotionExcludedGiftProduct", d.excludedGiftProductIds || []],
    ];
    for (const [model, ids] of linkSets) {
      const unique = [...new Set(ids.map(Number))];
      if (!unique.length) continue;
      await (tx as any)[model].createMany({ data: unique.map((productId) => ({ promotionId, productId })), skipDuplicates: true });
    }
    const catSets: [("promotionEligibleCategory" | "promotionExcludedCategory"), number[]][] = [
      ["promotionEligibleCategory", d.eligibleCategoryIds || []],
      ["promotionExcludedCategory", d.excludedCategoryIds || []],
    ];
    for (const [model, ids] of catSets) {
      const unique = [...new Set(ids.map(Number))];
      if (!unique.length) continue;
      await (tx as any)[model].createMany({ data: unique.map((categoryId) => ({ promotionId, categoryId })), skipDuplicates: true });
    }
    return promotionId;
  });

  return { id };
}

export async function deletePromotion(id: string) {
  /* Order matters: PromotionTierSlot.giftPoolId is Restrict, so the slots have
     to go before their pool — SQLite cascade order is not deterministic. */
  await db.$transaction(async (tx) => {
    const tiers = await tx.promotionTier.findMany({ where: { promotionId: id }, select: { id: true } });
    const tierIds = tiers.map((t) => t.id);
    if (tierIds.length) await tx.promotionTierSlot.deleteMany({ where: { tierId: { in: tierIds } } });
    await tx.promotionTier.deleteMany({ where: { promotionId: id } });
    await tx.promotionGiftPool.deleteMany({ where: { promotionId: id } });
    await tx.promotionEligibleProduct.deleteMany({ where: { promotionId: id } });
    await tx.promotionExcludedProduct.deleteMany({ where: { promotionId: id } });
    await tx.promotionEligibleCategory.deleteMany({ where: { promotionId: id } });
    await tx.promotionExcludedCategory.deleteMany({ where: { promotionId: id } });
    await tx.promotionExcludedGiftProduct.deleteMany({ where: { promotionId: id } });
    await tx.promotionUsage.deleteMany({ where: { promotionId: id } });
    await tx.promotion.delete({ where: { id } });
  });
}

/* ----------------------------------------------------------------- preview */

const PREVIEW_PRODUCT_INCLUDE = {
  images: { orderBy: { position: "asc" as const }, take: 1 },
  variants: { orderBy: { id: "asc" as const } },
};

/**
 * Runs the real engine against an UNSAVED draft so the admin sees exactly what
 * shoppers would get. Dates are neutralised (always “live”) — activation is what
 * the schedules are for, not the preview.
 */
export async function previewDraft(input: {
  draft: PromotionDraft;
  items: { productId: number; variantId?: number | null; qty: number }[];
}) {
  const d = input.draft;

  const poolProductIds = new Set<number>();
  const autoCategoryIds = new Set<number>();
  for (const pool of d.pools || []) {
    for (const row of pool.products || []) poolProductIds.add(Number(row.productId));
    if (pool.autoFill) for (const id of pool.categoryIds || []) autoCategoryIds.add(Number(id));
  }
  /* Cart products must load too — the shop side of the preview. */
  for (const item of input.items || []) poolProductIds.add(Number(item.productId));

  const [rows, autoRows] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...poolProductIds] } }, include: PREVIEW_PRODUCT_INCLUDE }),
    autoCategoryIds.size
      ? db.product.findMany({ where: { status: "ACTIVE", categoryId: { in: [...autoCategoryIds] } }, include: PREVIEW_PRODUCT_INCLUDE })
      : Promise.resolve([]),
  ]);
  const byId = new Map([...rows, ...autoRows].map((p) => [p.id, p]));

  const poolKeyByKey = new Map((d.pools || []).map((pool) => [pool.key, `pool:${pool.key}`]));
  const pseudo = {
    id: d.id || "preview",
    slug: d.slug || "preview",
    name: d.name || "Preview",
    description: d.description ?? null,
    type: "GIFT_TIERS",
    /* The preview answers “what would shoppers get”, so status and schedule are
       ignored on purpose — a draft must be testable before it goes live. */
    status: "ACTIVE",
    priority: 0,
    startsAt: new Date(0),
    endsAt: null,
    countMode: d.countMode,
    eligibilityScope: d.eligibilityScope,
    highestTierWins: !!d.highestTierWins,
    lockGrantedGifts: !!d.lockGrantedGifts,
    lockBehavior: "KEEP_ALL",
    requireGiftSelection: !!d.requireGiftSelection,
    allowGiftSkipping: !!d.allowGiftSkipping,
    maxGiftsPerOrder: d.maxGiftsPerOrder ?? null,
    maxOrders: d.maxOrders ?? null,
    usedOrders: 0,
    config: "{}",
    eligibleProducts: (d.eligibleProductIds || []).map((productId) => ({ productId })),
    excludedProducts: (d.excludedProductIds || []).map((productId) => ({ productId })),
    eligibleCategories: (d.eligibleCategoryIds || []).map((categoryId) => ({ categoryId })),
    excludedCategories: (d.excludedCategoryIds || []).map((categoryId) => ({ categoryId })),
    excludedGiftItems: (d.excludedGiftProductIds || []).map((productId) => ({ productId })),
    tiers: (d.tiers || []).map((tier) => ({
      index: tier.index, key: tier.key, label: tier.label, description: tier.description ?? null,
      requiredQuantity: Math.max(1, Math.round(tier.requiredQuantity)),
      slots: (tier.slots || []).map((slot) => ({
        key: slot.key, label: slot.label, giftType: slot.giftType || "CUSTOM",
        quantity: Math.max(1, Math.round(slot.quantity || 1)),
        giftPoolId: poolKeyByKey.get(slot.poolKey) || "",
        giftPool: { key: slot.poolKey },
      })),
    })),
    giftPools: (d.pools || []).map((pool) => {
      const handPicked = (pool.products || [])
        .map((row) => ({ variantIds: JSON.stringify(row.variantIds || []), product: byId.get(Number(row.productId)) }))
        .filter((row) => !!row.product);
      const auto = pool.autoFill
        ? [...autoRows]
            .filter((p) => (pool.categoryIds || []).map(Number).includes(Number(p.categoryId)))
            .map((product) => ({ variantIds: "[]", product }))
        : [];
      return {
        id: poolKeyByKey.get(pool.key)!, key: pool.key, label: pool.label, description: pool.description ?? null,
        excludeProductIds: JSON.stringify((pool.excludeProductIds || []).map(Number)),
        products: [...handPicked, ...auto],
      };
    }),
  };

  const engine: EnginePromotion = toEnginePromotion(pseudo);

  const items = (input.items || []).filter((i) => byId.has(Number(i.productId)) && i.qty > 0);
  const lines: StoreCartLine[] = items.map((i, n) => {
    const p = byId.get(Number(i.productId))!;
    const variants = Array.isArray((p as any).variants) ? (p as any).variants : [];
    const variant = variants.find((v: any) => Number(v.id) === Number(i.variantId)) || variants[0] || null;
    return {
      key: `preview-${n}`,
      productId: p.id,
      variantId: variant ? variant.id : undefined,
      slug: p.slug,
      title: p.title,
      image: (p as any).images?.[0]?.url ?? undefined,
      price: variant?.price ?? p.price,
      qty: Math.max(1, Math.min(99, Math.round(i.qty))),
      stock: variant?.stock ?? p.stock,
    };
  });

  const categories: Record<string, string> = {};
  for (const p of byId.values()) if (p.categoryId != null) categories[String(p.id)] = String(p.categoryId);

  const selections: GiftSelectionMap = {};
  const evaluation = evaluateCart({ promotion: engine, lines, selections, categories });
  return {
    view: toComboView(engine, evaluation),
    dropLines: giftLinesToDrop(evaluation, lines),
  };
}
