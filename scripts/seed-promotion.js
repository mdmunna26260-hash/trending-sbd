#!/usr/bin/env node
/**
 * Seed the "Choose More. Get More." gift-tier promotion.
 *
 *   node scripts/seed-promotion.js          # dev SQLite
 *   node scripts/seed-promotion.js --reset  # wipe existing promotions first
 *
 * Rules seeded (the owner's spec):
 *   Buy 3 → free Shirt / T-Shirt
 *   Buy 4 → free Baggy Denim      (highestTierWins: the shirt is REPLACED, not added)
 *   Buy 6 → free Baggy Denim + Shirt (both, at the same time)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const RESET = process.argv.includes("--reset");

/* Pool membership is by product slug so the seed keeps working when ids change.
   In the admin UI this is hand-picked (with a category auto-fill helper). */
const POOLS = [
  { key: "shirts", label: "Shirt / T-Shirt", description: "Pick any shirt or t-shirt", slugs: ["oversized-linen-shirt", "relaxed-heavyweight-tee"] },
  { key: "denim", label: "Baggy Denim", description: "Baggy denim pieces", slugs: ["wide-leg-tailored-trousers", "camel-wool-overcoat"] },
];

const TIERS = [
  { index: 1, key: "tier-3", label: "Buy 3 — Free Shirt / T-Shirt", requiredQuantity: 3, slots: [{ key: "shirt", label: "Shirt / T-Shirt", giftType: "SHIRT", poolKey: "shirts" }] },
  { index: 2, key: "tier-4", label: "Buy 4 — Free Baggy Denim", requiredQuantity: 4, slots: [{ key: "denim", label: "Baggy Denim", giftType: "DENIM", poolKey: "denim" }] },
  {
    index: 3, key: "tier-6", label: "Buy 6 — Free Baggy Denim + Shirt", requiredQuantity: 6,
    slots: [
      { key: "denim", label: "Baggy Denim", giftType: "DENIM", poolKey: "denim" },
      { key: "shirt", label: "Shirt / T-Shirt", giftType: "SHIRT", poolKey: "shirts" },
    ],
  },
];

(async () => {
  if (RESET) {
    const removed = await prisma.promotion.deleteMany({});
    console.log(`[promo] removed ${removed.count} existing promotion(s)`);
  }

  // resolve pool products
  const resolved = [];
  for (const pool of POOLS) {
    const products = await prisma.product.findMany({ where: { slug: { in: pool.slugs } }, select: { id: true, slug: true, variants: { select: { id: true } } } });
    if (!products.length) console.log(`[promo] WARNING pool "${pool.key}" has no matching products`);
    resolved.push({ ...pool, products });
    console.log(`[promo] pool ${pool.key}: ${products.map((p) => p.slug).join(", ") || "(empty)"}`);
  }

  const promotion = await prisma.promotion.create({
    data: {
      slug: "choose-more-get-more",
      name: "Choose More. Get More.",
      description: "Buy more, get more — free pieces at 3, 4 and 6 items.",
      type: "GIFT_TIERS",
      status: "ACTIVE",
      priority: 10,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: null,
      countMode: "QUANTITY",
      eligibilityScope: "ALL_PRODUCTS",
      highestTierWins: true,       // 4 items → denim REPLACES the shirt
      lockGrantedGifts: false,     // cart drops below the tier → gift goes with it
      lockBehavior: "KEEP_ALL",
      requireGiftSelection: true,  // showing the picker is mandatory…
      allowGiftSkipping: true,     // …but the shopper may decline the gift
      giftPools: {
        create: resolved.map((pool, i) => ({
          key: pool.key,
          label: pool.label,
          description: pool.description ?? null,
          sortOrder: i,
          products: { create: pool.products.map((p, j) => ({ productId: p.id, sortOrder: j })) },
        })),
      },
    },
    include: { giftPools: true },
  });

  const poolsByKey = Object.fromEntries(promotion.giftPools.map((p) => [p.key, p.id]));

  for (const [ti, tier] of TIERS.entries()) {
    await prisma.promotionTier.create({
      data: {
        promotionId: promotion.id,
        index: tier.index,
        key: tier.key,
        label: tier.label,
        requiredQuantity: tier.requiredQuantity,
        sortOrder: ti,
        slots: {
          create: tier.slots.map((slot, si) => ({
            key: slot.key,
            label: slot.label,
            giftType: slot.giftType,
            quantity: 1,
            sortOrder: si,
            giftPoolId: poolsByKey[slot.poolKey],
          })),
        },
      },
    });
  }

  const full = await prisma.promotion.findUnique({
    where: { id: promotion.id },
    include: { tiers: { include: { slots: true }, orderBy: { index: "asc" } }, giftPools: { include: { products: true } } },
  });
  console.log(`\n[promo] ACTIVE: ${full.name} (${full.slug})`);
  for (const t of full.tiers) {
    console.log(`   Tier ${t.index}: ${t.requiredQuantity}+ items → ${t.slots.map((s) => s.label).join(" + ")}`);
  }
  console.log(`   highestTierWins=${full.highestTierWins}  allowGiftSkipping=${full.allowGiftSkipping}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
