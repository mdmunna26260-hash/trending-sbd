const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const load = loader();
const pricing = load('lib/checkout-pricing.ts');
const cart = load('lib/checkout-items.ts');
const settings = load('lib/settings-values.ts');
const publicSettings = loader({ 'next/cache': { unstable_cache: fn => fn, revalidateTag() {} }, './db': { db: {} } })('lib/settings.ts').publicSettings;
const { validateCoupon, CouponValidationError } = load('lib/coupons.ts');

const product = (patch = {}) => ({ id: 1, title: 'Test shirt', price: 200, stock: 10, preorder: false, variants: [{ id: 11, size: 'M', price: null, stock: 10 }, { id: 12, size: 'L', price: 0, stock: 10 }], images: [{ url: '/second', position: 1 }, { url: '/first', position: 0 }], ...patch });
const line = (patch = {}) => ({ productId: 1, variantId: 11, qty: 1, ...patch });

test('zero free-shipping threshold disables the promotion, not the delivery fee', () => {
  const total = pricing.checkoutTotals({ subtotal: 200, area: 'INSIDE_DHAKA', shipping: { freeShippingThreshold: 0, insideDhaka: 80 } });
  assert.equal(total.deliveryFee, 80);
  assert.equal(total.total, 280);
});
test('zero configured delivery fee remains valid and legacy gift-wrap values add no charge', () => {
  const total = pricing.checkoutTotals({ subtotal: 200, area: 'OUTSIDE_DHAKA', shipping: { outsideDhaka: 0 }, checkout: { giftWrapFee: 95 }, giftWrap: true });
  assert.equal(total.deliveryFee, 0);
  assert.equal(total.total, 200);
  assert.equal(Object.hasOwn(total, 'giftWrapFee'), false);
});
test('legacy gift-wrap flags and settings never change the checkout total', () => {
  const total = pricing.checkoutTotals({ subtotal: 200, area: 'OUTSIDE_DHAKA', shipping: { outsideDhaka: 140 }, checkout: { giftWrapFee: 95 }, giftWrap: true });
  assert.equal(total.total, 340);
});
test('public settings no longer expose a retired gift-wrap fee', () => {
  const exposed = publicSettings({ checkout: { codEnabled: true, giftWrapFee: 95 }, shipping: {} });
  assert.equal(exposed.checkout.codEnabled, true);
  assert.equal(Object.hasOwn(exposed.checkout, 'giftWrapFee'), false);
});
test('freeDelivery OFF: threshold ar freeship coupon dutoi ignore — delivery charge always lage', () => {
  const input = { subtotal: 1000, discount: 100, area: 'INSIDE_DHAKA', shipping: { freeShippingThreshold: 1000, insideDhaka: 80 } };
  assert.equal(pricing.checkoutTotals(input).deliveryFee, 80, 'threshold ignore hobe');
  assert.equal(pricing.checkoutTotals({ ...input, freeship: true }).deliveryFee, 80, 'coupon freeship ignore hobe');
  /* boro order — age ৳5000 er upore free hoto, ekhon fee lage */
  const big = { subtotal: 6000, area: 'INSIDE_DHAKA', shipping: { freeShippingThreshold: 5000, insideDhaka: 80 } };
  assert.equal(pricing.checkoutTotals(big).deliveryFee, 80);
  assert.equal(pricing.checkoutTotals(big).total, 6080);
  /* bahirer Dhaka — nijer fee */
  assert.equal(pricing.checkoutTotals({ ...big, area: 'OUTSIDE_DHAKA', shipping: { freeShippingThreshold: 5000, outsideDhaka: 140 } }).deliveryFee, 140);
});

test('freeDelivery ON (mock): switch ta abar on korle purono behaviour ferot ashe — restore path jinda ache', () => {
  const on = loader({ './features': { FEATURES: { freeDelivery: true } } })('lib/checkout-pricing.ts');
  const input = { subtotal: 1000, discount: 100, area: 'INSIDE_DHAKA', shipping: { freeShippingThreshold: 1000, insideDhaka: 80 } };
  assert.equal(on.checkoutTotals(input).deliveryFee, 80, 'discounted subtotal 900 < threshold 1000');
  assert.equal(on.checkoutTotals({ ...input, freeship: true }).deliveryFee, 0, 'freeship coupon kaj kore');
  const big = { subtotal: 6000, area: 'INSIDE_DHAKA', shipping: { freeShippingThreshold: 5000, insideDhaka: 80 } };
  assert.equal(on.checkoutTotals(big).deliveryFee, 0, 'threshold puro hoyeche → free');
});
test('coupon discounts are recomputed, capped to the subtotal and rounded', () => {
  assert.equal(pricing.couponDiscount(100, { type: 'fixed', value: 500 }), 100);
  assert.equal(pricing.couponDiscount(105, { type: 'percent', value: 10 }), 10.5);
  assert.equal(pricing.couponDiscount(1000, { type: 'percent', value: 50, maxDiscount: 20 }), 20);
  assert.equal(pricing.couponDiscount(100, { type: 'fixed', value: -30 }), 0);
});
test('invalid settings amounts fall back safely, but a numeric zero remains valid', () => {
  assert.equal(pricing.nonNegativeAmount('not a number', 80), 80);
  assert.equal(pricing.nonNegativeAmount(-10, 80), 80);
  assert.equal(pricing.nonNegativeAmount('0', 80), 0);
});
test('checkout rejects fractional, negative, zero, boolean and non-finite quantities', () => {
  for (const qty of [0, -1, 1.5, true, Infinity, 'NaN', 100]) assert.throws(() => cart.parseCheckoutLines([line({ qty })]), cart.CheckoutValidationError);
});
test('checkout rejects invalid product/variant identifiers before querying Prisma', () => {
  for (const patch of [{ productId: true }, { productId: -1 }, { productId: 'abc' }, { variantId: 0 }, { variantId: 1.2 }]) assert.throws(() => cart.parseCheckoutLines([line(patch)]), cart.CheckoutValidationError);
  assert.throws(() => cart.parseCheckoutLines([]), /cart is empty/);
  assert.throws(() => cart.parseCheckoutLines(Array.from({ length: 51 }, () => line())), /Too many/);
});
test('duplicate cart lines merge before the stock check', () => {
  const lines = cart.parseCheckoutLines([line({ qty: 6 }), line({ qty: 6 })]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 12);
  assert.throws(() => cart.buildCheckoutItems(lines, [product()]), /Not enough stock/);
});
test('aggregate quantities across sizes cannot exceed product-level stock', () => {
  const lines = cart.parseCheckoutLines([line({ qty: 6 }), line({ variantId: 12, qty: 6 })]);
  assert.throws(() => cart.buildCheckoutItems(lines, [product()]), /Not enough stock/);
});
test('missing/foreign variants never fall back to a product price', () => {
  assert.throws(() => cart.buildCheckoutItems([line({ variantId: 999 })], [product()]), /variant/);
  assert.throws(() => cart.buildCheckoutItems([line({ variantId: null })], [product()]), /size\/color/);
});
test('checkout never silently clamps the quantity the customer ordered', () => {
  assert.throws(() => cart.buildCheckoutItems([line({ qty: 3 })], [product({ stock: 2 })]), /Not enough stock/);
});
test('zero-price variants are respected; the first image follows its position', () => {
  const result = cart.buildCheckoutItems([line({ variantId: 12 })], [product()]);
  assert.equal(result.subtotal, 0);
  assert.equal(result.items[0].price, 0);
  assert.equal(result.items[0].image, '/first');
});
test('preorders can have zero stock without weakening normal stock checks', () => {
  const result = cart.buildCheckoutItems([line({ qty: 2 })], [product({ stock: 0, preorder: true, variants: [{ id: 11, stock: 0, price: 200 }] })]);
  assert.equal(result.items[0].qty, 2);
  assert.equal(result.items[0].preorder, true);
  assert.equal(result.subtotal, 400);
});
test('unavailable products and unbounded prices fail with a validation error', () => {
  assert.throws(() => cart.buildCheckoutItems([line()], []), cart.CheckoutValidationError);
  assert.throws(() => cart.buildCheckoutItems([line()], [product({ price: Infinity })]), cart.CheckoutValidationError);
});

const coupon = (patch = {}) => ({ id: 1, code: 'SAVE', type: 'percent', value: 10, active: true, usedCount: 0, usageLimit: null, minOrder: null, maxDiscount: null, perCustomer: null, firstOrderOnly: false, startsAt: null, endsAt: null, ...patch });
test('preview/checkout share coupon dates, min order, usage and type validation', async () => {
  const tx = { order: { count: async () => 0 } };
  for (const c of [null, coupon({ active: false }), coupon({ startsAt: new Date(Date.now() + 60000) }), coupon({ endsAt: new Date(0) }), coupon({ minOrder: 500 }), coupon({ usedCount: 1, usageLimit: 1 }), coupon({ type: 'arbitrary' })]) await assert.rejects(validateCoupon(tx, c, 200), CouponValidationError);
});
test('per-customer coupon limits are checked against the canonical phone', async () => {
  let query;
  const tx = { order: { count: async (q) => { query = q; return 1; } } };
  await assert.rejects(validateCoupon(tx, coupon({ perCustomer: 1 }), 200, '01712345678'), /already used/);
  assert.equal(query.where.phone, '01712345678');
  assert.equal(query.where.couponCode, 'SAVE');
});
test('first-order-only coupons are not accepted for returning customers', async () => {
  await assert.rejects(validateCoupon({ order: { count: async () => 1 } }, coupon({ firstOrderOnly: true }), 200, '01712345678'), /first order only/);
});
test('coupon preview returns pricing metadata for quantity changes', async () => {
  const result = await validateCoupon({ order: { count: async () => 0 } }, coupon(), 200);
  assert.deepEqual(result, { code: 'SAVE', type: 'percent', value: 10, maxDiscount: null, discount: 20, freeship: false });
});

test('saving nested masked secrets preserves credentials and untouched fields', () => {
  const current = { smtp: { host: 'smtp.example', port: 587, pass: 'actual-smtp-password' }, sms: { apiKey: 'actual-sms-key', senderId: 'sender' } };
  const merged = settings.mergeSettingsValue(current, { smtp: { port: 465, pass: '••••••••word' }, sms: { apiKey: '••••••••-key' } });
  assert.equal(merged.smtp.pass, current.smtp.pass);
  assert.equal(merged.smtp.host, current.smtp.host);
  assert.equal(merged.smtp.port, 465);
  assert.equal(merged.sms.apiKey, current.sms.apiKey);
  assert.equal(current.smtp.port, 587);
});
test('settings merge replaces arrays and ignores prototype-pollution keys', () => {
  assert.deepEqual(settings.mergeSettingsValue([1, 2], [3]), [3]);
  const merged = settings.mergeSettingsValue({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"shipping":{"insideDhaka":0}}'));
  assert.equal(merged.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(merged.shipping.insideDhaka, 0);
  assert.equal(Object.hasOwn(merged, 'constructor'), false);
});
test('all known secrets are masked, including OAuth/bridge keys and internal ticket rows', () => {
  const data = { courier: { apiKey: 'long-secret-api-key', secretKey: 'short' }, integrations: { googleClientSecret: 'long-google-secret', metaAccessToken: 'long-meta-secret' }, notifications: { waBridgeKey: 'long-bridge-secret', telegramBotToken: 'long-telegram-token', smtp: { pass: 'long-smtp-secret' }, sms: { apiKey: 'long-sms-secret' } }, 'security.usedTicket.somehash': 'internal-value' };
  const masked = settings.maskAdminSettings(data);
  assert.equal(Object.keys(masked).some((k) => k.startsWith('security.')), false);
  for (const value of ['long-secret-api-key', 'long-google-secret', 'long-bridge-secret', 'long-smtp-secret', 'internal-value']) assert.equal(JSON.stringify(masked).includes(value), false);
  assert.equal(masked.courier.secretKey, '••••••');
  assert.equal(data.notifications.smtp.pass, 'long-smtp-secret');
});

const user = { id: 7, email: 'admin@example.test', name: 'Admin', role: 'SUPER_ADMIN', sv: 0 };
const emptyCookies = { cookies: async () => ({ get: () => undefined }) };
function authLoader(db, env) { return loader({ './db': { db }, 'next/headers': emptyCookies }, env); }

test('customer sessions and 2FA tickets cannot authenticate as admin sessions', () => {
  const modules = authLoader({});
  const auth = modules('lib/auth.ts');
  const customer = modules('lib/customer-auth.ts');
  assert.equal(auth.verifyToken(customer.createCustomerToken({ id: 7, phone: '01712345678', name: 'Customer' })), null);
  assert.equal(auth.verifyToken(auth.sessionTicket(7, 0)), null);
  assert.equal(customer.verifyCustomerToken(auth.createToken(user)), null);
  assert.equal(auth.verifyToken(auth.createToken(user)).role, 'SUPER_ADMIN');
});
test('tokens require exactly one signature, finite expiry and a valid purpose/shape', () => {
  const modules = authLoader({});
  const auth = modules('lib/auth.ts');
  const token = auth.createToken(user);
  assert.equal(auth.verifyToken(token + '.extra'), null);
  assert.equal(auth.verifyToken({}), null);
  const { encodeSessionPayload } = modules('lib/session-token.ts');
  for (const payload of [{ ...user, exp: 'forever' }, { ...user, exp: 0 }, { ...user, id: -1, exp: Date.now() + 60000 }, { ...user, role: '__proto__', exp: Date.now() + 60000 }, { ...user, p: '2fa', exp: Date.now() + 60000 }]) assert.equal(auth.verifyToken(encodeSessionPayload(payload)), null);
});
test('sessions use the current DB role, not elevated privileges in an old token', async () => {
  const current = { ...user, sessionVersion: 0, active: true, role: 'PRODUCT_MANAGER' };
  const modules = authLoader({ user: { findUnique: async () => current } });
  const auth = modules('lib/auth.ts');
  assert.equal((await auth.verifySessionToken(auth.createToken(user))).role, 'PRODUCT_MANAGER');
});
test('disabled/deleted accounts and revoked legacy/URL tokens are refused', async () => {
  let current = { ...user, sessionVersion: 1, active: true };
  const modules = authLoader({ user: { findUnique: async () => current } });
  const auth = modules('lib/auth.ts');
  const legacy = auth.createToken({ id: user.id, email: user.email, name: user.name, role: user.role });
  assert.equal(await auth.verifySessionToken(legacy), null);
  current = { ...current, sessionVersion: 0, active: false };
  assert.equal(await auth.verifySessionToken(legacy), null);
  current = null;
  assert.equal(await auth.verifySessionToken(legacy), null);
});
test('production customer sessions do not accept the published dev signing key', () => {
  const modules = authLoader({}, { NODE_ENV: 'production', SESSION_SECRET: 'dev-secret-change-me' });
  const customer = modules('lib/customer-auth.ts');
  const body = Buffer.from(JSON.stringify({ id: 7, phone: '01712345678', name: 'Customer', kind: 'customer', exp: Date.now() + 60000 })).toString('base64url');
  const forged = body + '.' + crypto.createHmac('sha256', 'dev-secret-change-me').update(body).digest('base64url');
  assert.equal(customer.verifyCustomerToken(forged), null);
  assert.equal(customer.customerCookie('token').secure, true);
});
test('production URL tokens are disabled for both account and request paths', async () => {
  const modules = authLoader({ customer: { findUnique: async () => ({ phone: '01712345678', name: 'Customer' }) } }, { NODE_ENV: 'production', SESSION_SECRET: 'test-production-secret', AUTH_URL_TOKEN: '0' });
  const customer = modules('lib/customer-auth.ts');
  const token = customer.createCustomerToken({ id: 7, phone: '01712345678', name: 'Customer' });
  assert.equal(customer.customerTokenFromRequest(new Request('https://store.test/api/auth/me?ct=' + token)), null);
  assert.equal(await customer.getCustomerSessionFromRequest(undefined, token), null);
});
test('customer APIs accept httpOnly cookies and refresh a stale phone from the DB', async () => {
  const modules = authLoader({ customer: { findUnique: async () => ({ phone: '01812345678', name: 'Updated name' }) } });
  const customer = modules('lib/customer-auth.ts');
  const token = customer.createCustomerToken({ id: 7, phone: '01712345678', name: 'Old name' });
  const session = await customer.getCustomerSessionFromRequest(new Request('https://store.test/api/auth/me', { headers: { cookie: 'other=abc; sz_customer=' + encodeURIComponent(token) } }));
  assert.equal(session.phone, '01812345678');
  assert.equal(session.name, 'Updated name');
  assert.equal(await customer.getCustomerSessionFromRequest(new Request('https://store.test/api/auth/me', { headers: { cookie: 'sz_customer=%zz' } })), null);
});
test('2FA tickets are unique and cannot accept malformed account/version values', () => {
  const modules = authLoader({});
  const auth = modules('lib/auth.ts');
  assert.notEqual(auth.sessionTicket(7, 0), auth.sessionTicket(7, 0));
  assert.deepEqual(auth.verifySessionTicket(auth.sessionTicket(7, 0)), { id: 7, sv: 0 });
  const { encodeSessionPayload } = modules('lib/session-token.ts');
  assert.equal(auth.verifySessionTicket(encodeSessionPayload({ id: -1, sv: 0, p: '2fa', exp: Date.now() + 60000 })), null);
});
test('all admin data pages enforce a permission before rendering', () => {
  const root = path.resolve(__dirname, '../app/admin/(panel)');
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name, 'page.tsx');
    if (!fs.existsSync(file)) continue;
    assert.match(fs.readFileSync(file, 'utf8'), /requireAdmin\([^;]+,\s*(?:"[a-z]+"|\["[a-z]+")/, name);
  }
});
