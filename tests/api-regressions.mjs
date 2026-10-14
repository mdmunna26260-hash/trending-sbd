/* Real HTTP + database regressions. Uses temporary fixtures and restores settings.
   Deliberately refuses remote/production databases. Start a seeded local app, then:
   AUDIT_ALLOW_MUTATIONS=1 SMOKE_ADMIN_PASSWORD=... npm run test:api
   Export DATABASE_URL first (the CLI does not implicitly load .env). */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
/* Refuse anything that is not an isolated LOCAL database. SQLite (file:) always qualifies;
   PostgreSQL qualifies only when the URL points at loopback, so a staging or production
   Postgres host is still rejected outright — these suites write and delete rows.

   Allowing loopback Postgres matters because production does not run SQLite: docker-compose.yml
   ships postgres:16-alpine. The two engines differ in locking, transaction isolation, DDL
   (`ADD COLUMN IF NOT EXISTS` exists only in Postgres) and query planning, so a suite that can
   only ever execute against SQLite cannot tell you what production will actually do. */
const DB_URL = process.env.DATABASE_URL || '';
const dbIsLocal = DB_URL.startsWith('file:')
  || (/^postgres(ql)?:\/\//.test(DB_URL)
      && ['127.0.0.1', 'localhost', '::1'].includes((() => { try { return new URL(DB_URL).hostname; } catch { return ''; } })()));
if (!['localhost', '127.0.0.1', '0.0.0.0'].includes(new URL(BASE).hostname) || !dbIsLocal || process.env.NODE_ENV === 'production' || process.env.AUDIT_ALLOW_MUTATIONS !== '1') {
  throw new Error('Use an isolated local database (SQLite file: or loopback PostgreSQL) and set AUDIT_ALLOW_MUTATIONS=1. This test changes temporary data/settings; never run it against a live store.');
}
if (!process.env.SMOKE_ADMIN_PASSWORD) throw new Error('SMOKE_ADMIN_PASSWORD is required');
const db = new PrismaClient();
const tag = 'regression-' + crypto.randomBytes(6).toString('hex');
const productIds = [], couponIds = [], userIds = [], phones = [], ticketKeys = [];
const originals = new Map();
let adminCookie = '', pass = 0, fail = 0, skipped = 0, sequence = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗', name, detail); }
};
const skip = (name, why) => { skipped++; console.log('  ⊘', name, '— ' + why); };
const cookieOf = (response, name) => (response.setCookie || '').split(/, (?=[^;]+=[^;]+)/).find((c) => c.startsWith(name + '='))?.split(';')[0] || '';
async function request(path, options = {}) {
  const cookie = options.cookie ?? ((path.startsWith('/api/admin/') || path.startsWith('/admin')) ? adminCookie : '');
  const r = await fetch(BASE + path, { method: options.method || (options.json !== undefined ? 'POST' : 'GET'), redirect: 'manual', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.250.${Math.floor(++sequence / 250)}.${sequence % 250 + 1}`, ...(cookie ? { cookie } : {}) }, ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}) });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, text, location: r.headers.get('location'), setCookie: r.headers.get('set-cookie') };
}
async function expect(name, path, options, status) {
  const result = await request(path, options);
  check(name, result.status === status, `status=${result.status} ${result.body?.error || ''}`);
  return result;
}
function redirected(result, target) {
  return result.location?.includes(target) || result.text.includes('NEXT_REDIRECT;replace;' + target + ';') || result.text.includes('url=' + target + '\"');
}
async function expectRedirect(name, path, cookie, target = '/admin/login') {
  const result = await request(path, { cookie });
  // App Router can flush a loading boundary before redirect(): that is a 200
  // with a redirect meta/RSC marker, not a 307. Private page data must be absent.
  check(name, redirected(result, target) && !result.text.includes('phoneBlocked'), `status=${result.status}`);
  return result;
}
async function freshPhone() {
  let phone;
  do { phone = '017' + String(crypto.randomInt(10000000, 100000000)); } while (await db.customer.findUnique({ where: { phone } }));
  phones.push(phone); return phone;
}
async function save(group, value) {
  if (!originals.has(group)) originals.set(group, await db.setting.findUnique({ where: { key: group } }));
  const result = await request('/api/admin/settings', { method: 'PUT', json: { group, value } });
  assert.equal(result.status, 200, 'fixture settings save failed: ' + result.body?.error);
}
async function product(data = {}) {
  const p = await db.product.create({ data: { title: tag, slug: tag + '-' + productIds.length, price: 200, stock: 10, status: 'ACTIVE', variants: { create: [{ size: 'M', stock: 10 }, { size: 'L', stock: 10, price: 0 }] }, ...data }, include: { variants: true } });
  productIds.push(p.id); return p;
}
async function coupon(data) {
  const c = await db.coupon.create({ data: { code: tag.toUpperCase() + '-' + couponIds.length, type: 'fixed', value: 20, ...data } });
  couponIds.push(c.id); return c;
}
async function checkout(p, extra = {}) {
  return { name: 'Regression Customer', phone: await freshPhone(), address: 'House 99, Road 12, Banani, Dhaka', area: 'INSIDE_DHAKA', paymentMethod: 'COD', items: [{ productId: p.id, variantId: p.variants[0].id, qty: 1 }], ...extra };
}
async function place(p, extra = {}) {
  const input = await checkout(p, extra);
  const result = await request('/api/checkout', { json: input });
  assert.equal(result.status, 200, 'fixture checkout failed: ' + result.body?.error);
  const order = await db.order.findUnique({ where: { code: result.body.code }, include: { items: true } });
  assert.ok(order); return { result, order, input };
}
async function update(id, json) { return request('/api/admin/orders/' + id, { method: 'PUT', json }); }
async function counts(p) {
  const product = await db.product.findUnique({ where: { id: p.id }, include: { variants: { orderBy: { id: 'asc' } } } });
  return [product.stock, product.variants[0].stock];
}

try {
  console.log('API regressions →', BASE, '(isolated local fixtures)');
  const login = await request('/api/admin/login', { json: { email: process.env.SMOKE_ADMIN_EMAIL || 'Sinzo.bd@gmail.com', password: process.env.SMOKE_ADMIN_PASSWORD }, cookie: '' });
  assert.equal(login.status, 200); assert.equal(login.body.ok, true);
  adminCookie = cookieOf(login, 'sz_session'); assert.ok(adminCookie);
  await save('shipping', { insideDhaka: 80, outsideDhaka: 140, freeShippingThreshold: 0 });
  await save('checkout', { codEnabled: true, giftWrapFee: 95 });
  const checkoutSettings = await request('/api/admin/settings');
  check('legacy gift-wrap pricing is stripped from checkout settings', checkoutSettings.body?.settings?.checkout?.giftWrapFee === undefined);
  const p = await product();

  const publicCustomers = await expectRedirect('customer admin page is private without a session', '/admin/customers', '');
  check('unauthenticated customer page redirects to login', redirected(publicCustomers, '/admin/login'));
  const customerPhone = await freshPhone();
  const register = await expect('customer registration succeeds', '/api/auth/register', { json: { name: 'Regression Customer', phone: customerPhone, password: 'Local-fixture-pass-2026' } }, 200);
  const customerCookie = cookieOf(register, 'sz_customer'); assert.ok(customerCookie);
  const me = await expect('customer cookie alone authenticates profile/prefill', '/api/auth/me', { cookie: customerCookie }, 200);
  check('customer prefill returns the signed-in phone', me.body?.customer?.phone === customerPhone);
  await expect('customer cookie alone can save a profile', '/api/account/update', { cookie: customerCookie, json: { name: 'Updated Regression Customer', address: 'House 12, Road 10, Dhaka' } }, 200);
  await expect('a customer token in the admin cookie is refused', '/api/admin/products', { cookie: customerCookie.replace('sz_customer=', 'sz_session=') }, 401);
  await expectRedirect('a customer token cannot open admin data pages', '/admin/customers', customerCookie.replace('sz_customer=', 'sz_session='));

  const roles = await db.user.create({ data: { email: tag + '@roles.test', name: tag, password: await bcrypt.hash('Local-role-fixture-2026', 10), role: 'PRODUCT_MANAGER' } }); userIds.push(roles.id);
  const roleLogin = await request('/api/admin/login', { json: { email: roles.email, password: 'Local-role-fixture-2026' }, cookie: '' });
  const roleCookie = cookieOf(roleLogin, 'sz_session'); assert.ok(roleCookie);
  await expect('whoami accepts a non-order staff role', '/api/admin/whoami', { cookie: roleCookie }, 200);
  await expect('product manager cannot read customer APIs', '/api/admin/orders', { cookie: roleCookie }, 403);
  const denied = await expectRedirect('product manager cannot read server-rendered customer data', '/admin/customers', roleCookie, '/admin/products?denied=1');
  check('permission denial leads to a role-appropriate page', redirected(denied, '/admin/products?denied=1'));
  await db.user.update({ where: { id: roles.id }, data: { active: false } });
  await expect('disabled staff sessions are immediately rejected', '/api/admin/products', { cookie: roleCookie }, 401);

  const recoveryCode = crypto.randomBytes(5).toString('hex');
  const twoFactor = await db.user.create({ data: { email: tag + '@2fa.test', name: tag, password: await bcrypt.hash('Local-2fa-fixture-2026', 10), role: 'SUPER_ADMIN', twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP', recoveryCodes: crypto.createHash('sha256').update(recoveryCode).digest('hex') } }); userIds.push(twoFactor.id);
  /* 2FA block. lib/features.ts can switch the second factor off (adminTwoFactor: false, owner
     request 2026-10-08) and app/api/admin/login/route.ts guards it on
     FEATURES.adminTwoFactor && user.twoFactorEnabled && user.twoFactorSecret. The fixture above
     is enrolled in both, so the flag is the ONLY thing that can suppress needs2fa — reading the
     flag and cross-checking it against the server is therefore precise rather than a guess.

     Skip only when source and behaviour AGREE the feature is off. The opposite mismatch — flag on
     but the server not asking — is a real authentication bypass and still aborts loudly with a
     message saying so; a blind "needs2fa is undefined, so skip" would have hidden exactly that.
     The block is self-contained: nothing below it reads ticket, twoFactorCookie or twoFactor.
     Previously this was an unconditional assert, so one hard failure here stopped the suite at
     check 15 and the remaining 69 checks never ran at all. */
  // .catch() keeps this file portable: sinzo-commerce has no lib/features.ts at all, and the two
  // repositories share these suites. Missing file => no such flag => the block runs normally.
  const featuresSrc = await readFile(new URL('../lib/features.ts', import.meta.url), 'utf8').catch(() => '');
  const twoFactorFlagOff = /adminTwoFactor:\s*false/.test(featuresSrc);
  const firstFactor = async () => {
    const r = await request('/api/admin/login', { json: { email: twoFactor.email, password: 'Local-2fa-fixture-2026' }, cookie: '' });
    assert.equal(r.body.needs2fa, true, 'adminTwoFactor is enabled in lib/features.ts but the login route did not ask for the second factor — authentication bypass');
    ticketKeys.push('security.usedTicket.' + crypto.createHash('sha256').update(r.body.ticket).digest('hex')); return r.body.ticket;
  };
  if (twoFactorFlagOff) {
    const off = await request('/api/admin/login', { json: { email: twoFactor.email, password: 'Local-2fa-fixture-2026' }, cookie: '' });
    if (off.body?.needs2fa !== true) skip('2FA block (6 checks)', 'adminTwoFactor: false in lib/features.ts, and the login route agrees');
    else check('adminTwoFactor is off in lib/features.ts but the login route still asks for it', false, 'flag and behaviour disagree');
  } else {
  const ticket = await firstFactor();
  await expect('2FA password-step ticket is not an admin session', '/api/admin/products', { cookie: 'sz_session=' + ticket }, 401);
  await expectRedirect('2FA ticket cannot open admin data pages', '/admin/customers', 'sz_session=' + ticket);
  const raced = await Promise.all([1, 2].map(() => request('/api/admin/login/2fa', { json: { ticket, code: recoveryCode }, cookie: '' })));
  check('concurrent 2FA ticket/recovery-code use succeeds only once', raced.filter((r) => r.status === 200).length === 1 && raced.filter((r) => r.status === 401).length === 1, raced.map((r) => r.status).join(','));
  await expect('2FA ticket replay is rejected', '/api/admin/login/2fa', { json: { ticket, code: recoveryCode }, cookie: '' }, 401);
  const twoFactorCookie = cookieOf(raced.find((r) => r.status === 200), 'sz_session');
  await expect('team management refuses an own-password change', '/api/admin/users/' + twoFactor.id, { method: 'PUT', cookie: twoFactorCookie, json: { password: 'Should-never-be-applied-2026' } }, 403);
  check('denied self-password change leaves credentials untouched', (await db.user.findUnique({ where: { id: twoFactor.id } })).password === twoFactor.password);
  const revokedTicket = await firstFactor();
  await db.user.update({ where: { id: twoFactor.id }, data: { sessionVersion: { increment: 1 } } });
  await expect('2FA ticket is invalid after session revocation', '/api/admin/login/2fa', { json: { ticket: revokedTicket, code: recoveryCode }, cookie: '' }, 401);
  }

  for (const qty of [0, -1, 1.5]) await expect('checkout rejects quantity ' + qty, '/api/checkout', { json: await checkout(p, { items: [{ productId: p.id, variantId: p.variants[0].id, qty }] }) }, 400);
  await expect('checkout rejects a nonexistent variant instead of falling back', '/api/checkout', { json: await checkout(p, { items: [{ productId: p.id, variantId: 2147483647, qty: 1 }] }) }, 400);
  await expect('checkout requires a size/color when a product has variants', '/api/checkout', { json: await checkout(p, { items: [{ productId: p.id, qty: 1 }] }) }, 400);
  await expect('checkout rejects oversize quantity instead of silently changing it', '/api/checkout', { json: await checkout(p, { items: [{ productId: p.id, variantId: p.variants[0].id, qty: 11 }] }) }, 400);
  await expect('duplicate lines cannot bypass the stock check', '/api/checkout', { json: await checkout(p, { items: Array.from({ length: 2 }, () => ({ productId: p.id, variantId: p.variants[0].id, qty: 6 })) }) }, 400);
  await expect('stock is checked across different sizes of the same product', '/api/checkout', { json: await checkout(p, { items: p.variants.map((v) => ({ productId: p.id, variantId: v.id, qty: 6 })) }) }, 400);
  await expect('invalid coupon does not silently create a full-price order', '/api/checkout', { json: await checkout(p, { couponCode: 'DOES-NOT-EXIST' }) }, 400);
  const zero = await place(p, { items: [{ productId: p.id, variantId: p.variants[1].id, qty: 1 }] });
  check('zero-price variant is honored by the server', zero.order.subtotal === 0 && zero.order.total === 80);
  const legacyWrap = await place(p, { giftWrap: true, attribution: { utm_source: { invalid: true } } });
  check('legacy gift-wrap flags cannot add a checkout charge or order note', legacyWrap.order.subtotal === 200 && legacyWrap.order.deliveryFee === 80 && legacyWrap.order.total === 280 && !String(legacyWrap.order.notes || '').includes('GIFT WRAP'));
  check('malformed attribution does not break a valid checkout', legacyWrap.result.status === 200);
  await save('shipping', { insideDhaka: 0 });
  const free = await place(p);
  check('an explicitly zero delivery fee stays zero', free.order.deliveryFee === 0 && free.order.total === 200);
  await save('shipping', { insideDhaka: 80 });
  await save('checkout', { codEnabled: false });
  await expect('server refuses COD when disabled in settings', '/api/checkout', { json: await checkout(p) }, 400);
  await save('checkout', { codEnabled: true, onlinePaymentEnabled: true });
  await expect('online-payment toggle cannot authorize an arbitrary payment method', '/api/checkout', { json: await checkout(p, { paymentMethod: 'BOGUS' }) }, 400);

  const limited = await coupon({ perCustomer: 1 });
  const used = await place(p, { couponCode: limited.code });
  await expect('checkout enforces per-customer coupon usage', '/api/checkout', { json: await checkout(p, { phone: used.input.phone, couponCode: limited.code }) }, 400);
  const preview = await request('/api/coupon', { json: { code: limited.code, subtotal: 200, phone: '+88' + used.input.phone } });
  check('coupon preview normalizes international BD phone numbers', preview.body?.valid === false && /already used/.test(preview.body?.error || ''));
  const firstOnly = await coupon({ firstOrderOnly: true });
  await expect('checkout enforces first-order-only coupon usage', '/api/checkout', { json: await checkout(p, { phone: used.input.phone, couponCode: firstOnly.code }) }, 400);
  const globalLimit = await coupon({ usageLimit: 1 });
  const couponRace = await Promise.all([await checkout(p, { couponCode: globalLimit.code }), await checkout(p, { couponCode: globalLimit.code })].map((json) => request('/api/checkout', { json })));
  check('concurrent coupon checkouts never exceed the global usage limit', couponRace.filter((r) => r.status === 200).length === 1 && couponRace.filter((r) => r.status === 400).length === 1, couponRace.map((r) => r.status).join(','));
  check('failed coupon checkouts do not consume additional uses', (await db.coupon.findUnique({ where: { id: globalLimit.id } })).usedCount === 1);
  const largeDiscount = await coupon({ value: 500 });
  const capped = await place(p, { couponCode: largeDiscount.code });
  check('stored coupon discount is capped to the real subtotal', capped.order.discount === 200 && capped.order.total === 80);

  const manual = await product();
  await expect('stock take can explicitly set stock and cost to zero', '/api/admin/stock', { json: { productId: manual.id, mode: 'set', qty: '0', unitCost: '0', note: tag } }, 200);
  const zeroStock = await db.product.findUnique({ where: { id: manual.id } });
  const zeroMovement = await db.inventoryMovement.findFirst({ where: { productId: manual.id }, orderBy: { id: 'desc' } });
  check('zero stock take records its exact adjustment and cost', zeroStock.stock === 0 && zeroStock.cost === 0 && zeroMovement.delta === -10);
  for (const qty of [1.5, '', -1]) await expect('manual stock rejects invalid/negative-result quantity ' + JSON.stringify(qty), '/api/admin/stock', { json: { productId: manual.id, qty } }, 400);
  check('failed manual adjustments leave the stock unchanged', (await db.product.findUnique({ where: { id: manual.id } })).stock === 0);
  const restocks = await Promise.all([2, 3].map((qty) => request('/api/admin/stock', { json: { productId: manual.id, qty, note: tag } })));
  check('concurrent restocks do not overwrite each other', restocks.every((r) => r.status === 200) && (await db.product.findUnique({ where: { id: manual.id } })).stock === 5, restocks.map((r) => r.status).join(','));
  const stockLedger = await db.inventoryMovement.findMany({ where: { productId: manual.id, reason: 'RESTOCK' }, orderBy: { delta: 'asc' } });
  check('concurrent restock ledger records both actual deltas', JSON.stringify(stockLedger.map((r) => r.delta)) === '[2,3]');
  await expect('stock adjustment rejects an unknown mode', '/api/admin/stock', { json: { productId: manual.id, qty: 1, mode: 'bogus' } }, 400);
  await expect('stock adjustment rejects a negative unit cost', '/api/admin/stock', { json: { productId: manual.id, qty: 1, unitCost: -1 } }, 400);
  await expect('stock ledger rejects malformed product filters', '/api/admin/stock?product=bogus', {}, 400);
  await expect('stock ledger safely bounds malformed pagination', '/api/admin/stock?take=NaN', {}, 200);
  const concurrentOrder = await place(manual, { items: [{ productId: manual.id, variantId: manual.variants[0].id, qty: 2 }] });
  const stockAndDelivery = await Promise.all([request('/api/admin/stock', { json: { productId: manual.id, qty: '4' } }), update(concurrentOrder.order.id, { status: 'DELIVERED' })]);
  check('restock and delivery cannot lose either inventory update', stockAndDelivery.every((r) => r.status === 200) && (await db.product.findUnique({ where: { id: manual.id } })).stock === 7, stockAndDelivery.map((r) => r.status).join(','));

  const inventory = await product();
  const placed = await place(inventory, { items: [{ productId: inventory.id, variantId: inventory.variants[0].id, qty: 2 }] });
  check('checkout preserves delivery-time stock policy', JSON.stringify(await counts(inventory)) === '[10,10]');
  let order = placed.order;
  await expect('editing pending order quantity succeeds', '/api/admin/orders/' + order.id, { method: 'PUT', json: { items: [{ id: order.items[0].id, qty: 3, price: 200 }] } }, 200);
  check('editing a pending order does not decrement stock', JSON.stringify(await counts(inventory)) === '[10,10]');
  await expect('manual delivery updates status and inventory', '/api/admin/orders/' + order.id, { method: 'PUT', json: { status: 'DELIVERED' } }, 200);
  check('delivery deducts the correct product and variant quantity', JSON.stringify(await counts(inventory)) === '[7,7]');
  order = await db.order.findUnique({ where: { id: order.id }, include: { items: true } });
  check('actual delivery deduction is recorded per line', order.stockDeducted && order.items[0].stockDeductedQty === 3);
  await update(order.id, { status: 'DELIVERED' });
  check('repeated delivery does not double-decrement stock', JSON.stringify(await counts(inventory)) === '[7,7]');
  await update(order.id, { items: [{ id: order.items[0].id, qty: 4, price: 200 }] });
  check('editing a delivered quantity adjusts stock only by the delta', JSON.stringify(await counts(inventory)) === '[6,6]');
  await update(order.id, { status: 'RETURNED' });
  check('return restores exact deducted quantities and resets the claim', JSON.stringify(await counts(inventory)) === '[10,10]' && !(await db.order.findUnique({ where: { id: order.id } })).stockDeducted);
  await Promise.all([update(order.id, { status: 'RETURNED' }), update(order.id, { status: 'CANCELLED' })]);
  check('duplicate/concurrent return/cancellation never inflates stock', JSON.stringify(await counts(inventory)) === '[10,10]');
  const redelivery = await Promise.all([update(order.id, { status: 'DELIVERED' }), update(order.id, { status: 'DELIVERED' })]);
  check('concurrent redelivery succeeds without double-deducting', redelivery.every((r) => r.status === 200) && JSON.stringify(await counts(inventory)) === '[6,6]', redelivery.map((r) => r.status).join(','));
  await expect('bulk return uses the same stock lifecycle', '/api/admin/orders/bulk', { json: { ids: [order.id], action: 'status', value: 'RETURNED' } }, 200);
  check('bulk return really restores inventory', JSON.stringify(await counts(inventory)) === '[10,10]');
  await expect('bulk delivery uses the same stock lifecycle', '/api/admin/orders/bulk', { json: { ids: [order.id], action: 'status', value: 'DELIVERED' } }, 200);
  check('bulk delivery really deducts inventory', JSON.stringify(await counts(inventory)) === '[6,6]');
  await expect('invalid order status is rejected', '/api/admin/orders/' + order.id, { method: 'PUT', json: { status: 'NOT-A-STATUS' } }, 400);
  await expect('fractional admin order quantity is rejected', '/api/admin/orders/' + order.id, { method: 'PUT', json: { items: [{ id: order.items[0].id, price: 200, qty: 1.5 }] } }, 400);
  await expect('duplicate admin item IDs are rejected atomically', '/api/admin/orders/' + order.id, { method: 'PUT', json: { items: Array.from({ length: 2 }, () => ({ id: order.items[0].id, price: 200, qty: 1 })) } }, 400);
  check('failed item edits leave inventory unchanged', JSON.stringify(await counts(inventory)) === '[6,6]');

  const shortage = await product();
  const shortOrder = await place(shortage, { items: [{ productId: shortage.id, variantId: shortage.variants[0].id, qty: 4 }] });
  await db.product.update({ where: { id: shortage.id }, data: { stock: 2 } });
  await db.productVariant.update({ where: { id: shortage.variants[0].id }, data: { stock: 2 } });
  await update(shortOrder.order.id, { status: 'DELIVERED' });
  check('short-stock delivery stays non-negative and records actual deduction', JSON.stringify(await counts(shortage)) === '[0,0]' && (await db.orderItem.findUnique({ where: { id: shortOrder.order.items[0].id } })).stockDeductedQty === 2);
  await update(shortOrder.order.id, { status: 'RETURNED' });
  check('a short-stock return cannot invent the undeducted quantity', JSON.stringify(await counts(shortage)) === '[2,2]');

  // Historical returns left stockDeducted=true, with no per-line deduction field.
  const legacyProduct = await product({ stock: 10 });
  const legacyPhone = await freshPhone();
  const legacy = await db.order.create({ data: { code: tag + '-legacy', name: 'Regression Customer', phone: legacyPhone, address: 'House 99, Road 12, Dhaka', area: 'INSIDE_DHAKA', subtotal: 400, total: 480, deliveryFee: 80, status: 'RETURNED', stockDeducted: true, items: { create: { productId: legacyProduct.id, variantId: legacyProduct.variants[0].id, title: tag, price: 200, qty: 2 } } } });
  await db.inventoryMovement.create({ data: { productId: legacyProduct.id, delta: 2, reason: 'RETURN', ref: legacy.code } });
  await update(legacy.id, { status: 'RETURNED' });
  check('stale legacy return flags do not cause a second restock', JSON.stringify(await counts(legacyProduct)) === '[10,10]');
  await update(legacy.id, { status: 'DELIVERED' });
  check('a previously returned legacy order can be redelivered correctly', JSON.stringify(await counts(legacyProduct)) === '[8,8]');

  await save('notifications', { enabled: false, waBridgeKey: 'fixture-bridge-super-secret', smtp: { host: 'smtp.invalid', user: 'fixture', pass: 'fixture-smtp-super-secret', port: 587 }, sms: { apiKey: 'fixture-sms-super-secret', enabled: false } });
  await save('integrations', { googleClientSecret: 'fixture-google-super-secret' });
  const masked = await request('/api/admin/settings');
  check('OAuth/bridge/SMTP/SMS secrets are masked in settings responses', ['fixture-google-super-secret', 'fixture-bridge-super-secret', 'fixture-smtp-super-secret', 'fixture-sms-super-secret'].every((secret) => !masked.text.includes(secret)));
  check('settings responses exclude internal 2FA ticket claims', !Object.keys(masked.body.settings).some((key) => key.startsWith('security.')));
  await save('notifications', { smtp: { ...masked.body.settings.notifications.smtp, port: 465 }, sms: masked.body.settings.notifications.sms });
  const stored = JSON.parse((await db.setting.findUnique({ where: { key: 'notifications' } })).value);
  check('saving masked nested credentials preserves their actual values', stored.smtp.pass === 'fixture-smtp-super-secret' && stored.sms.apiKey === 'fixture-sms-super-secret' && stored.smtp.port === 465);
  await expect('negative delivery fee configuration is rejected', '/api/admin/settings', { method: 'PUT', json: { group: 'shipping', value: { insideDhaka: -10 } } }, 400);
  await expect('internal security settings cannot be written through the settings API', '/api/admin/settings', { method: 'PUT', json: { group: 'security.usedTickets', value: [] } }, 400);
  await expect('malformed coupon subtotal is refused', '/api/coupon', { json: { code: limited.code, subtotal: 'not-a-number' } }, 400);
} catch (error) {
  fail++; console.error('  ✗ regression suite aborted:', error.message);
} finally {
  try {
    // Only fixture identifiers are removed. Original configuration is restored exactly.
    const fixtureOrders = await db.order.findMany({ where: { phone: { in: phones } }, select: { id: true, code: true } });
    await db.waMessage.deleteMany({ where: { orderId: { in: fixtureOrders.map((order) => order.id) } } });
    await db.notification.deleteMany({ where: { ref: { in: fixtureOrders.map((order) => order.code) } } });
    await db.order.deleteMany({ where: { phone: { in: phones } } });
    await db.customer.deleteMany({ where: { phone: { in: phones } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.coupon.deleteMany({ where: { id: { in: couponIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.setting.deleteMany({ where: { key: { in: ticketKeys } } });
    for (const [group, original] of originals) {
      if (original) {
        await db.setting.upsert({ where: { key: group }, update: { value: original.value }, create: original });
        // Save through the API too, to invalidate the app's settings cache.
        await request('/api/admin/settings', { method: 'PUT', json: { group, value: JSON.parse(original.value) } });
      } else await db.setting.deleteMany({ where: { key: group } });
    }
  } catch (error) { fail++; console.error('Fixture cleanup failed:', error.message); }
  await db.$disconnect();
}
console.log(`\nAPI regressions: ${pass} passed, ${fail} failed` + (skipped ? `, ${skipped} skipped (hidden by lib/features.ts)` : ``));
process.exitCode = fail ? 1 : 0;
