/* The storefront gift panel computes everything in the browser with these same
   pure modules, so this file tests exactly what a shopper's cart will do —
   including the rule the user gave us: 3 items → shirt, 4 items → denim INSTEAD
   of the shirt, 6 items → both together. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const load = loader();
const { evaluateCart, toComboView, giftLinesToDrop } = load('lib/promotions/service.ts');
const { slotSelectionKey } = load('lib/promotions/engine.ts');

const PROMO_ID = 'promo-1';
const money = (n) => n * 100; // taka → poisha (minor units)

const candidate = (id, price) => ({
  productId: String(100 + id),
  variantId: String(1000 + id),
  productSlug: `gift-${id}`,
  productName: `Gift piece ${id}`,
  sku: `G-${id}`,
  variantLabel: `M / Black`,
  colorName: 'Black',
  priceMinor: money(price),
  compareAtMinor: null,
  imageUrl: null,
  stockQty: 5,
  selectable: true,
});

const promotion = {
  id: PROMO_ID,
  slug: 'choose-more-get-more',
  name: 'Choose More. Get More.',
  description: 'Buy more, get more',
  type: 'GIFT_TIERS',
  status: 'ACTIVE',
  priority: 10,
  startsAt: new Date(Date.now() - 86_400_000),
  endsAt: null,
  countMode: 'QUANTITY',
  eligibilityScope: 'ALL_PRODUCTS',
  highestTierWins: true,
  lockGrantedGifts: false,
  lockBehavior: 'KEEP_ALL',
  requireGiftSelection: true,
  allowGiftSkipping: true,
  maxGiftsPerOrder: null,
  maxOrders: null,
  usedOrders: 0,
  config: {},
  eligibleProductIds: [],
  excludedProductIds: [],
  eligibleCategoryIds: [],
  excludedCategoryIds: [],
  excludedGiftProductIds: [],
  tiers: [
    { index: 1, key: 'tier-3', label: 'Buy 3 — Free Shirt / T-Shirt', description: null, requiredQuantity: 3,
      slots: [{ key: 'shirt', label: 'Shirt / T-Shirt', giftType: 'SHIRT', quantity: 1, poolKey: 'shirts' }] },
    { index: 2, key: 'tier-4', label: 'Buy 4 — Free Baggy Denim', description: null, requiredQuantity: 4,
      slots: [{ key: 'denim', label: 'Baggy Denim', giftType: 'DENIM', quantity: 1, poolKey: 'denim' }] },
    { index: 3, key: 'tier-6', label: 'Buy 6 — Free Denim + Shirt', description: null, requiredQuantity: 6,
      slots: [
        { key: 'denim', label: 'Baggy Denim', giftType: 'DENIM', quantity: 1, poolKey: 'denim' },
        { key: 'shirt', label: 'Shirt / T-Shirt', giftType: 'SHIRT', quantity: 1, poolKey: 'shirts' },
      ] },
  ],
  giftPools: [
    { id: 'pool-shirts', key: 'shirts', label: 'Shirt / T-Shirt', description: null, excludeProductIds: [], candidates: Array.from({ length: 20 }, (_, i) => candidate(i + 1, 1890)) },
    { id: 'pool-denim', key: 'denim', label: 'Baggy Denim', description: null, excludeProductIds: [], candidates: Array.from({ length: 16 }, (_, i) => candidate(i + 50, 2450)) },
  ],
};

/** A paid cart line, exactly as components/store.tsx keeps it. */
const line = (n, qty = 1) => ({
  key: `cart-${n}:${n}`,
  productId: n,
  variantId: n,
  slug: `cart-item-${n}`,
  title: `Cart item ${n}`,
  price: 1000,
  qty,
  stock: 10,
});

/** The view the panel renders — the same call the component makes in render. */
const view = (lines, selections = {}) => {
  const engine = { ...promotion };
  const evaluation = evaluateCart({ promotion: engine, lines, selections, categories: {} });
  return { evaluation, view: toComboView(engine, evaluation) };
};

test('3 items unlock the shirt slot with tap-able pieces', () => {
  const { view: v } = view([line(1), line(2), line(3)]);
  assert.equal(v.eligibleCount, 3);
  assert.equal(v.currentTierIndex, 1);
  assert.equal(v.tiers.length, 3, 'the ladder always shows all three tiers');
  const shirt = v.slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.status, 'NEEDS_SELECTION');
  assert.equal(shirt.candidates.filter((c) => c.selectable).length, 20);
  assert.equal(view([line(1), line(2), line(3)]).view.nextTier.requiredQuantity, 4);
});

test('quantity multiplies into the tier count', () => {
  const { view: v } = view([line(1, 3)]);
  assert.equal(v.eligibleCount, 3);
  assert.equal(v.currentTierIndex, 1);
});

test('4 items replace the shirt with denim — never both', () => {
  const { view: v } = view([line(1), line(2), line(3), line(4)]);
  assert.equal(v.currentTierIndex, 2);
  const keys = v.slots.map((s) => s.key);
  assert.deepEqual(keys, ['denim']);
  assert.equal(v.slots[0].candidates.filter((c) => c.selectable).length, 16);
});

test('6 items grant denim and shirt together', () => {
  const { view: v } = view([line(1, 3), line(2, 3)]);
  assert.equal(v.eligibleCount, 6);
  assert.equal(v.currentTierIndex, 3);
  assert.deepEqual(v.slots.map((s) => s.key).sort(), ['denim', 'shirt']);
});

test('the slot key contract the panel depends on', () => {
  const { evaluation, view: v } = view([line(1), line(2), line(3)]);

  /* ENGINE slot:  key = "<tierIndex>:<slotKey>"  (this is the localStorage
     selection key) and slotKey = "shirt" (this goes into the gift cart line).
     Mixing the two up is how a picked gift used to vanish — pinned here. */
  const engineSlot = evaluation.slots.find((s) => s.slotKey === 'shirt');
  assert.equal(engineSlot.key, '1:shirt');
  assert.equal(engineSlot.slotKey, 'shirt');

  /* VIEW slot (what the UI gets):  key = "shirt", selectionKey = "1:shirt". */
  for (const slot of v.slots) {
    assert.equal(typeof slot.key, 'string');
    assert.equal(typeof slot.selectionKey, 'string');
    assert.equal(typeof slot.tierIndex, 'number');
    assert.equal(slot.selectionKey, `${slot.tierIndex}:${slot.key}`, 'selectionKey = <tier>:<slotKey>');
    assert.ok(Array.isArray(slot.candidates));
    for (const c of slot.candidates) {
      assert.equal(typeof c.productId, 'number', 'picker needs numeric ids for the cart line');
      assert.equal(typeof c.variantId, 'number');
      assert.equal(typeof c.price, 'number', 'picker shows the market value in taka');
    }
  }
});

test('a picked gift survives the next evaluation (the vanishing-gift bug)', () => {
  const lines = [line(1), line(2), line(3)];
  const pick = promotion.giftPools[0].candidates[0];
  const selections = { [slotSelectionKey(1, 'shirt')]: { productId: pick.productId, variantId: pick.variantId } };
  const giftRow = {
    key: `gift:${PROMO_ID}:1:shirt`, productId: Number(pick.productId), variantId: Number(pick.variantId),
    slug: pick.productSlug, title: pick.productName, price: 0, qty: 1, stock: 5,
    isGift: true, promotionId: PROMO_ID, tierIndex: 1, slotKey: 'shirt', giftValue: 1890,
  };

  const { evaluation, view: v } = view([...lines, giftRow], selections);
  assert.deepEqual(giftLinesToDrop(evaluation, [...lines, giftRow]), [], 'the earned gift must not be dropped');
  const shirt = v.slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.status, 'SELECTED');
  assert.equal(shirt.selectedVariantId, Number(pick.variantId));
  assert.equal(v.giftCount, 1);
  assert.equal(v.giftValue, 1890, 'the panel shows the gift market value in taka');
});

test('dropping back below the tier drops the gift row', () => {
  const giftRow = {
    key: `gift:${PROMO_ID}:2:denim`, productId: 150, variantId: 1050,
    slug: 'gift-50', title: 'Gift piece 50', price: 0, qty: 1, stock: 5,
    isGift: true, promotionId: PROMO_ID, tierIndex: 2, slotKey: 'denim', giftValue: 2450,
  };
  const lines = [line(1), line(2), line(3), giftRow]; // only 3 paid items now
  const { evaluation } = view(lines, { [slotSelectionKey(2, 'denim')]: { productId: '150', variantId: '1050' } });
  assert.deepEqual(giftLinesToDrop(evaluation, lines), [giftRow.key]);
});

test('gift rows never count towards the tier they unlock', () => {
  const giftRow = {
    key: `gift:${PROMO_ID}:1:shirt`, productId: 101, variantId: 1001,
    slug: 'gift-1', title: 'Gift piece 1', price: 0, qty: 1, stock: 5,
    isGift: true, promotionId: PROMO_ID, tierIndex: 1, slotKey: 'shirt', giftValue: 1890,
  };
  const { view: v } = view([line(1), line(2), giftRow]);
  assert.equal(v.eligibleCount, 2, 'two paid items stay two');
  assert.equal(v.currentTierIndex, null);
});

test('an out-of-stock pool still renders the slot, with nothing selectable', () => {
  const empty = { ...promotion, giftPools: [{ id: 'pool-shirts', key: 'shirts', label: 'Shirt / T-Shirt', description: null, candidates: [] }] };
  const evaluation = evaluateCart({ promotion: empty, lines: [line(1), line(2), line(3)], selections: {}, categories: {} });
  const v = toComboView(empty, evaluation);
  const shirt = v.slots.find((s) => s.key === 'shirt');
  assert.ok(shirt, 'the slot must still be in the view so the panel can explain itself');
  assert.equal(shirt.candidates.length, 0);
});

/* ---------- per-rule (pool) exclusions — admin er "Exclude from this pool" ----------
   candidate(id) → productId 100+id, variantId 1000+id. Shirts = 101…120, denim = 150…165. */
const viewWith = (promo, lines, selections = {}) => {
  const evaluation = evaluateCart({ promotion: promo, lines, selections, categories: {} });
  return toComboView(promo, evaluation);
};
const withPoolExclusions = ({ shirts = [], denim = [] } = {}) => ({
  ...promotion,
  giftPools: [
    { ...promotion.giftPools[0], excludeProductIds: shirts },
    { ...promotion.giftPools[1], excludeProductIds: denim },
  ],
});

test('pool exclusion: excluded piece tap-list theke chole jay, baki gulo thake', () => {
  const promo = withPoolExclusions({ shirts: ['101', '102', '103'] });
  const v = viewWith(promo, [line(1), line(2), line(3)]);
  const shirt = v.slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.candidates.filter((c) => c.selectable).length, 17, '20 - 3 excluded');
  for (const id of [101, 102, 103]) {
    assert.ok(!shirt.candidates.some((c) => c.productId === id), `excluded #${id} tap-list e thaka jabe na`);
  }
});

test('exclusion per-rule: shirt pool er list denim pool ke chhoy na', () => {
  const promo = withPoolExclusions({ shirts: ['101'], denim: ['150', '151'] });
  const shirt = viewWith(promo, [line(1), line(2), line(3)]).slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.candidates.filter((c) => c.selectable).length, 19, 'shirts: 20 - 1');
  const denim = viewWith(promo, [line(1), line(2), line(3), line(4)]).slots.find((s) => s.key === 'denim');
  assert.equal(denim.candidates.filter((c) => c.selectable).length, 14, 'denim: 16 - 2');
});

test('excluded product select kora thakle engine take bad dey — abar choice chay', () => {
  const promo = withPoolExclusions({ shirts: ['101'] });
  const stale = { '1:shirt': { productId: '101', variantId: '1001' } };
  const shirt = viewWith(promo, [line(1), line(2), line(3)], stale).slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.status, 'INELIGIBLE_SELECTION');
  assert.equal(shirt.blocking, true, 'customer ke abar choose korte hobe');
  assert.equal(shirt.selectedVariantId, null);
  assert.match(shirt.message, /no longer part of the offer/i);
});

test('global "never give these as gifts" + pool exclusion ekshathe kaj kore', () => {
  const promo = { ...withPoolExclusions({ shirts: ['101'] }), excludedGiftProductIds: ['104'] };
  const shirt = viewWith(promo, [line(1), line(2), line(3)]).slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.candidates.filter((c) => c.selectable).length, 18, '20 - 1 pool - 1 global');
  assert.ok(!shirt.candidates.some((c) => c.productId === 104));
});

test('khali exclude list = age er moto (kono behaviour change nei)', () => {
  const shirt = viewWith(withPoolExclusions(), [line(1), line(2), line(3)]).slots.find((s) => s.key === 'shirt');
  assert.equal(shirt.candidates.filter((c) => c.selectable).length, 20);
});
