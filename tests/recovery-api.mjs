/* Real local HTTP/Prisma/SMTP regression. SMTP listens ONLY on loopback and
   accepts ONLY synthetic .invalid recipients. Never run against a live store. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname) || !process.env.DATABASE_URL?.startsWith('file:') || process.env.NODE_ENV === 'production' || process.env.AUDIT_ALLOW_MUTATIONS !== '1') throw Error('Isolated local SQLite + AUDIT_ALLOW_MUTATIONS=1 required');
if (!process.env.SMOKE_ADMIN_PASSWORD || !process.env.CRON_SECRET) throw Error('Local admin password and CRON_SECRET required');
const db = new PrismaClient(), tag = 'recovery-' + crypto.randomBytes(5).toString('hex');
const phones = [], productIds = [], couponIds = [], userIds = [], keys = [], originals = new Map(), sockets = new Set(), mails = [];
let admin = '', seq = 0, passed = 0, rejectNext = false;
const smtp = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  socket.setEncoding('utf8'); socket.write('220 localhost test SMTP\r\n');
  let buffer = '', data = false, message = '', recipient = '';
  socket.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const at = buffer.indexOf('\r\n'); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      if (data) {
        if (line === '.') { data = false; mails.push({ recipient, raw: message }); message = ''; socket.write('250 2.0.0 Accepted\r\n'); }
        else message += line.replace(/^\.\./, '.') + '\r\n';
      } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 200000\r\n');
      else if (/^AUTH /i.test(line)) socket.write('235 2.7.0 Authenticated\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        recipient = line.match(/<([^>]+)>/)?.[1] || '';
        if (!recipient.endsWith('.invalid') || rejectNext) { rejectNext = false; socket.write('550 5.1.1 Test recipient rejected\r\n'); }
        else socket.write('250 2.1.5 OK\r\n');
      } else if (/^DATA$/i.test(line)) { data = true; socket.write('354 End with dot\r\n'); }
      else if (/^QUIT$/i.test(line)) socket.end('221 Goodbye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
  socket.on('error', () => {});
});
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
const port = smtp.address().port;
const ok = (label, condition) => { assert.ok(condition, label); passed++; console.log('  ✓', label); };
async function request(path, { method, json, cookie, cron, auth } = {}) {
  const r = await fetch(BASE + path, { method: method || (json === undefined ? 'GET' : 'POST'), headers: {
    'Content-Type': 'application/json', 'x-forwarded-for': `198.18.${Math.floor(++seq / 250) + 10}.${seq % 250 + 1}`,
    ...(cookie !== '' && (cookie || (path.startsWith('/api/admin/') ? admin : '')) ? { cookie: cookie || admin } : {}),
    ...(cron ? { Authorization: 'Bearer ' + process.env.CRON_SECRET } : auth ? { Authorization: auth } : {}),
  }, ...(json === undefined ? {} : { body: JSON.stringify(json) }), signal: AbortSignal.timeout(90_000) });
  const text = await r.text(); let body; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers, text };
}
async function save(group, value) {
  if (!originals.has(group)) originals.set(group, await db.setting.findUnique({ where: { key: group } }));
  const r = await request('/api/admin/settings', { method: 'PUT', json: { group, value } }); assert.equal(r.status, 200, r.body?.error);
}
async function phone() {
  let p; do { p = '018' + crypto.randomInt(10000000, 100000000); } while (await db.customer.findUnique({ where: { phone: p } }) || await db.abandonedCheckout.findFirst({ where: { phone: p } }));
  phones.push(p); return p;
}
async function capture(p, extra = {}) {
  const key = crypto.randomBytes(32).toString('hex'); keys.push(key);
  const input = { captureKey: key, revision: 1, name: 'Recovery Audit <b>Buyer</b>', phone: await phone(), email: tag + '-' + phones.length + '@example.invalid', address: 'House 20 Road 30 Dhaka local audit', area: 'OUTSIDE_DHAKA', giftWrap: false, notes: 'test only', items: [{ productId: p.id, variantId: p.variants[0].id, qty: 2 }], ...extra };
  const result = await request('/api/checkout/start', { json: input }); assert.equal(result.status, 200, result.body?.error);
  const row = await db.abandonedCheckout.findUnique({ where: { captureKeyHash: crypto.createHash('sha256').update(input.captureKey).digest('hex') } }); assert.ok(row);
  return { row, input };
}
async function link(row) {
  const r = await request(`/api/admin/abandoned/${row.id}/link`, { method: 'POST' }); assert.equal(r.status, 200, r.body?.error);
  const u = new URL(r.body.url); return { url: r.body.url, token: new URLSearchParams(u.hash.slice(1)).get('recover') };
}
const qp = text => text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const sign = payload => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return body + '.' + crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url'); };

try {
  const unsafe = await db.abandonedCheckout.count({ where: { checkoutStatus: 'OPEN', captureKeyHash: { not: null }, email: { not: null }, updatedAt: { lt: new Date(Date.now() - 45 * 60 * 1000) } } });
  assert.equal(unsafe, 0, 'Do not run when non-test eligible recovery rows exist');
  const login = await request('/api/admin/login', { json: { email: process.env.SMOKE_ADMIN_EMAIL || 'Sinzo.bd@gmail.com', password: process.env.SMOKE_ADMIN_PASSWORD }, cookie: '' });
  assert.equal(login.status, 200); admin = login.headers.get('set-cookie').split(';')[0];
  await save('shipping', { insideDhaka: 80, outsideDhaka: 140, freeShippingThreshold: 0 });
  await save('checkout', { codEnabled: true, giftWrapFee: 95 });
  await save('marketing', { recoveryCoupon: '', recoveryAutoEnabled: false });
  await save('notifications', { enabled: false, smtp: { host: '127.0.0.1', port, user: 'sender@example.invalid', from: 'sender@example.invalid', pass: 'local-test-no-real-credential', secure: false }, notifyEmail: '', waEnabled: false, telegramBotToken: '', telegramChatId: '' });
  await save('seo', { siteUrl: BASE });
  const p = await db.product.create({ data: { title: tag + ' <script>alert(1)</script>', slug: tag, price: 200, stock: 30, variants: { create: [{ size: 'M', stock: 30 }, { size: 'L', stock: 30, price: 0 }] } }, include: { variants: true } }); productIds.push(p.id);
  const c = await db.coupon.create({ data: { code: tag.toUpperCase(), type: 'fixed', value: 20, active: true, perCustomer: 1, usageLimit: 50 } }); couponIds.push(c.id);

  ok('anonymous recovery GET blocked before SMTP', (await request('/api/admin/abandoned-recover', { cookie: '' })).status === 401);
  ok('cookie-authenticated GET cannot send mail', (await request('/api/admin/abandoned-recover')).status === 401);
  ok('URL cron token is not accepted', (await request('/api/admin/abandoned-recover?token=' + process.env.CRON_SECRET, { cookie: '' })).status === 401);
  ok('bad cron bearer is rejected', (await request('/api/admin/abandoned-recover', { cookie: '', auth: 'Bearer wrong' })).status === 401);
  ok('authenticated cron is disabled until explicit opt-in', (await request('/api/admin/abandoned-recover', { cookie: '', cron: true })).body.disabled === true);
  ok('anonymous manual recovery POST denied', (await request('/api/admin/abandoned-recover', { method: 'POST', cookie: '' })).status === 401);
  ok('capture refuses legacy title/price-only payloads', (await request('/api/checkout/start', { json: { name: 'Buyer', phone: '01712345678', address: 'House Road Dhaka', items: [{ title: 'Fake', price: 1, qty: 1 }] } })).status === 400);

  const a = await capture(p, { giftWrap: true, total: 1, items: [{ productId: p.id, variantId: p.variants[0].id, qty: 2, price: 1, title: 'Fake cheap title' }] });
  const captured = JSON.parse(a.row.cartJson);
  ok('capture keeps real product and variant references', captured.version === 2 && captured.items[0].productId === p.id && captured.items[0].variantId === p.variants[0].id);
  ok('capture ignores forged title/price/total and never charges for a legacy gift-wrap flag', captured.items[0].price === 200 && a.row.total === 540 && captured.items[0].title === p.title && !Object.hasOwn(captured, 'giftWrap'));
  const updated = { ...a.input, revision: 2, phone: '+88' + a.input.phone, email: tag + '-changed@example.invalid', area: 'INSIDE_DHAKA', items: [{ productId: p.id, variantId: p.variants[0].id, qty: 3 }] };
  assert.equal((await request('/api/checkout/start', { json: updated })).status, 200);
  let current = await db.abandonedCheckout.findUnique({ where: { id: a.row.id } });
  ok('email/quantity/zone edits update the same private draft', current.email === updated.email && JSON.parse(current.cartJson).items[0].qty === 3 && current.total === 680);
  ok('international phone is stored canonically', current.phone === a.input.phone);
  await request('/api/checkout/start', { json: { ...a.input, revision: 1 } });
  current = await db.abandonedCheckout.findUnique({ where: { id: a.row.id } });
  ok('late stale capture cannot overwrite newer email/quantity', current.captureRevision === 2 && current.email === updated.email);
  await Promise.all([3, 4].map(revision => request('/api/checkout/start', { json: { ...updated, revision, items: [{ productId: p.id, variantId: p.variants[0].id, qty: revision }] } })));
  current = await db.abandonedCheckout.findUnique({ where: { id: a.row.id } });
  ok('concurrent capture revisions preserve the newest snapshot', current.captureRevision === 4 && JSON.parse(current.cartJson).items[0].qty === 4);
  const distinct = await capture(p, { phone: a.input.phone });
  ok('another browser cannot overwrite a draft by knowing its phone', distinct.row.id !== a.row.id);
  const secured = await link(current);
  ok('private recovery URL carries a fragment, not a query token', new URL(secured.url).search === '' && secured.token);
  ok('bad/tampered recovery tokens do not expose contact data', (await request('/api/checkout/recover', { json: { token: secured.token.slice(0, -3) + 'bad' } })).status === 410);
  const payload = JSON.parse(Buffer.from(secured.token.split('.')[0], 'base64url'));
  ok('expired signed recovery link rejected', (await request('/api/checkout/recover', { json: { token: sign({ ...payload, exp: Date.now() - 1000 }) } })).status === 410);
  ok('customer-purpose token cannot read a recovery cart', (await request('/api/checkout/recover', { json: { token: sign({ ...payload, purpose: 'customer', exp: Date.now() + 60000 }) } })).status === 410);
  await db.product.update({ where: { id: p.id }, data: { price: 250 } });
  await db.productVariant.update({ where: { id: p.variants[0].id }, data: { stock: 2 } });
  const restored = await request('/api/checkout/recover', { json: { token: secured.token } });
  ok('fresh-browser API restores live SKU data and current price', restored.status === 200 && restored.body.lines[0].price === 250 && restored.body.lines[0].variantId === p.variants[0].id);
  ok('stock reduction is explicit, never silently overcommitted', restored.body.lines[0].qty === 2 && restored.body.warnings.length >= 2);
  ok('delivery zone/contact are restored without address guessing', restored.body.contact.area === 'INSIDE_DHAKA' && restored.body.contact.email === updated.email);
  ok('recovery response omits legacy gift-wrap data and charges', !Object.hasOwn(restored.body, 'giftWrap') && !Object.hasOwn(restored.body.totals, 'giftWrapFee'));
  ok('private cart response cannot be cached', /no-store/.test(restored.headers.get('cache-control')));
  await db.productVariant.update({ where: { id: p.variants[0].id }, data: { stock: 30 } });
  await db.abandonedCheckout.update({ where: { id: a.row.id }, data: { email: tag + '-new@example.invalid' } });
  ok('contact changes revoke previously issued recovery links', (await request('/api/checkout/recover', { json: { token: secured.token } })).status === 410);

  await save('marketing', { recoveryCoupon: c.code, recoveryAutoEnabled: true });
  await db.abandonedCheckout.update({ where: { id: a.row.id }, data: { updatedAt: new Date(Date.now() - 46 * 60 * 1000) } });
  const before = mails.length;
  const jobs = await Promise.all([request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true }), request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true })]);
  ok('concurrent authenticated passes attempt one reminder per draft', jobs.every(j => j.status === 200) && jobs.reduce((n, j) => n + j.body.sent, 0) === 1 && mails.length === before + 1);
  current = await db.abandonedCheckout.findUnique({ where: { id: a.row.id } });
  ok('SMTP acceptance is durably marked', !!current.recoveryEmailedAt && !!current.recoveryAttemptedAt && current.recoveryClaimId === null);
  const decodedMail = qp(mails.at(-1).raw);
  ok('email escapes customer/product HTML', decodedMail.includes('&lt;script&gt;') && decodedMail.includes('&lt;b&gt;Buyer&lt;/b&gt;') && !decodedMail.includes('<script>alert'));
  ok('email has the private restore link and eligible coupon', decodedMail.includes('#recover=') && decodedMail.includes(c.code));
  const delivered = await link(current);
  const withCoupon = await request('/api/checkout/recover', { json: { token: delivered.token } });
  ok('recovery coupon is validated and supplied for automatic checkout application', withCoupon.body.applied.code === c.code && withCoupon.body.totals.discount === 20);
  ok('re-running pass does not resend accepted email', (await request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true })).body.sent === 0);
  await db.abandonedCheckout.update({ where: { id: distinct.row.id }, data: { email: current.email, updatedAt: new Date(Date.now() - 46 * 60 * 1000) } });
  ok('different drafts for the same recipient are cooldown-suppressed', (await request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true })).body.sent === 0);
  const settingsResponse = await request('/api/admin/settings');
  ok('internal mail cooldown rows stay out of settings responses', !Object.keys(settingsResponse.body.settings).some(k => k.startsWith('security.')));

  const checkoutKey = crypto.randomBytes(32).toString('hex'); keys.push(checkoutKey);
  const purchase = { ...withCoupon.body.contact, notes: withCoupon.body.notes, paymentMethod: 'COD', couponCode: withCoupon.body.applied.code, recoveryToken: delivered.token, captureKey: checkoutKey, items: withCoupon.body.lines.map(l => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })) };
  const purchases = await Promise.all([request('/api/checkout', { json: purchase }), request('/api/checkout', { json: purchase })]);
  ok('concurrent recovered checkout creates one order and returns the same code', purchases.every(r => r.status === 200) && purchases[0].body.code === purchases[1].body.code);
  await new Promise(r => setTimeout(r, 300));
  const order = await db.order.findUnique({ where: { code: purchases[0].body.code } });
  order.items = await db.orderItem.findMany({ where: { orderId: order.id } });
  ok('recovered order has linked inventory lines and source attribution', order.source === 'Recovered' && order.items[0].productId === p.id && order.items[0].variantId === p.variants[0].id);
  /* Derive the expectation from what /api/checkout/recover actually quoted instead of hardcoding
     a total. The previous literal was 560 = 2 x 250 + 80 - 20, computed from the draft's ORIGINAL
     qty — but the concurrency check above deliberately advances that same draft (a.row) to
     revision 4 with qty 4, and the price/area updates make the correct figure
     4 x 250 + 80 - 20 = 1060. The application was right and the literal was stale.

     Comparing every component against the quote is also a stronger test of the actual property:
     checkoutTotals() has no gift-wrap term at all, so if the legacy giftWrap flag could add the
     configured 95 fee, order.total would exceed what the customer was shown. And it cannot go
     stale again when an earlier check edits the cart. */
  const quoted = withCoupon.body.totals;
  ok('recovered legacy gift-wrap carts are not charged',
    order.subtotal === quoted.subtotal && order.deliveryFee === quoted.deliveryFee
    && order.discount === quoted.discount && order.total === quoted.total
    && !String(order.notes || '').includes('GIFT WRAP'));
  ok('coupon consumed only once across checkout retry', (await db.coupon.findUnique({ where: { id: c.id } })).usedCount === 1);
  ok('source draft and any late capture marker close atomically', (await db.abandonedCheckout.findUnique({ where: { id: a.row.id } })).convertedOrderId === order.id);
  const late = await request('/api/checkout/start', { json: { ...a.input, revision: 999 } });
  ok('late capture cannot resurrect a completed checkout', late.body.closed === true);
  ok('completed recovery link cannot be replayed to read/restore cart', (await request('/api/checkout/recover', { json: { token: delivered.token } })).status === 410);
  ok('converted checkout cannot be manually reopened', (await request(`/api/admin/abandoned/${a.row.id}`, { method: 'PUT', json: { status: 'OPEN' } })).status === 409);
  const initialStock = (await db.product.findUnique({ where: { id: p.id } })).stock;
  assert.equal((await request(`/api/admin/orders/${order.id}`, { method: 'PUT', json: { status: 'DELIVERED' } })).status, 200);
  ok('recovered customer order deducts linked stock only at delivery', (await db.product.findUnique({ where: { id: p.id } })).stock === initialStock - order.items[0].qty);

  const b = await capture(p, { area: 'OUTSIDE_DHAKA', giftWrap: true });
  const preview = await request(`/api/admin/abandoned/${b.row.id}/convert?preview=1`, { method: 'POST' });
  ok('admin preview ignores legacy gift-wrap and applies delivery fee/coupon: ' + JSON.stringify(preview.body), preview.body.area === 'OUTSIDE_DHAKA' && preview.body.total === 2 * 250 + 140 - 20 && !Object.hasOwn(preview.body, 'giftWrapFee'));
  ok('admin conversion rolls back if confirmed price changed', (await request(`/api/admin/abandoned/${b.row.id}/convert`, { json: { expectedTotal: 1 } })).status === 409);
  const conversions = await Promise.all([request(`/api/admin/abandoned/${b.row.id}/convert`, { json: { expectedTotal: preview.body.total } }), request(`/api/admin/abandoned/${b.row.id}/convert`, { json: { expectedTotal: preview.body.total } })]);
  ok('concurrent admin conversion is atomic and idempotent', conversions.every(r => r.status === 200) && conversions[0].body.orderId === conversions[1].body.orderId && await db.order.count({ where: { phone: b.input.phone } }) === 1);
  const converted = await db.order.findUnique({ where: { id: conversions[0].body.orderId } });
  converted.items = await db.orderItem.findMany({ where: { orderId: converted.id } });
  ok('admin recovery retains SKU/variant and correct outside Dhaka total', converted.items[0].productId === p.id && converted.items[0].variantId === p.variants[0].id && converted.total === preview.body.total && !String(converted.notes || '').includes('GIFT WRAP'));
  const beforeDelivery = (await db.product.findUnique({ where: { id: p.id } })).stock;
  assert.equal((await request(`/api/admin/orders/${converted.id}`, { method: 'PUT', json: { status: 'DELIVERED' } })).status, 200);
  ok('admin recovered order participates in real stock delivery lifecycle', (await db.product.findUnique({ where: { id: p.id } })).stock === beforeDelivery - 2);

  const failed = await capture(p);
  await db.abandonedCheckout.update({ where: { id: failed.row.id }, data: { updatedAt: new Date(Date.now() - 46 * 60 * 1000) } });
  rejectNext = true;
  const failure = await request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true });
  ok('SMTP rejection is tracked as failure', failure.body.failed === 1);
  ok('ambiguous/failed sends are not blindly auto-retried', (await request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true })).body.sent === 0);
  ok('retry requires explicit provider-not-delivered confirmation', (await request(`/api/admin/abandoned/${failed.row.id}/retry`, { json: {} })).status === 400);
  assert.equal((await request(`/api/admin/abandoned/${failed.row.id}/retry`, { json: { confirmedProviderNotDelivered: true } })).status, 200);
  ok('explicit reviewed retry can send after SMTP is corrected', (await request('/api/admin/abandoned-recover', { method: 'POST', cookie: '', cron: true })).body.sent === 1);
  const legacy = await db.abandonedCheckout.create({ data: { name: 'Legacy Audit', phone: await phone(), email: tag + '-legacy@example.invalid', address: 'House Road Dhaka Legacy', cartJson: '[{"title":"Fake","qty":1,"price":1}]', total: 1 } });
  ok('legacy title-only drafts are never guessed into linked orders', (await request(`/api/admin/abandoned/${legacy.id}/convert`, { method: 'POST' })).status === 400);
  ok('invalid purge days cannot delete pending carts', (await request('/api/admin/abandoned?olderThanDays=-1', { method: 'DELETE' })).status === 400);
  ok('invalid automation flag is rejected', (await request('/api/admin/abandoned-recover/settings', { method: 'PUT', json: { value: { recoveryCoupon: '', recoveryAutoEnabled: 'true' } } })).status === 400);
  console.log(`\nRecovery HTTP/DB/SMTP checks: ${passed} passed`);
} finally {
  // Allow postcommit fixture notifications/newsletter writes to finish.
  await new Promise(r => setTimeout(r, 300));
  for (const [group, original] of originals) {
    if (original) {
      await db.setting.upsert({ where: { key: group }, create: original, update: { value: original.value } });
      await request('/api/admin/settings', { method: 'PUT', json: { group, value: JSON.parse(original.value) } }).catch(() => {});
    } else {
      await request('/api/admin/settings', { method: 'PUT', json: { group, value: group === 'marketing' ? { recoveryAutoEnabled: false, recoveryCoupon: '' } : {} } }).catch(() => {});
      await db.setting.deleteMany({ where: { key: group } });
    }
  }
  await db.abandonedCheckout.deleteMany({ where: { phone: { in: phones } } });
  await db.waMessage.deleteMany({ where: { toWaId: { in: phones.map(p => '88' + p) } } });
  await db.inboxMessage.deleteMany({ where: { waId: { in: phones } } });
  await db.orderItem.deleteMany({ where: { order: { phone: { in: phones } } } });
  await db.payment.deleteMany({ where: { order: { phone: { in: phones } } } });
  const orders = await db.order.findMany({ where: { phone: { in: phones } }, select: { code: true } });
  await db.notification.deleteMany({ where: { ref: { in: orders.map(o => o.code) } } });
  await db.inventoryMovement.deleteMany({ where: { productId: { in: productIds } } });
  await db.order.deleteMany({ where: { phone: { in: phones } } });
  await db.customer.deleteMany({ where: { phone: { in: phones } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.coupon.deleteMany({ where: { id: { in: couponIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.subscriber.deleteMany({ where: { email: { startsWith: tag } } });
  for (const key of keys) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    await db.abandonedCheckout.deleteMany({ where: { captureKeyHash: hash } });
  }
  // Only private cooldowns owned by synthetic test contacts are removed.
  const emailNames = [tag + '-changed@example.invalid', tag + '-new@example.invalid', tag + '-legacy@example.invalid', ...phones.map((_, i) => tag + '-' + (i + 1) + '@example.invalid')];
  await db.setting.deleteMany({ where: { key: { in: [...phones.map(p => 'phone:' + p), ...emailNames.map(e => 'email:' + e)].map(s => 'security.recovery.recipient.' + crypto.createHash('sha256').update(s).digest('hex')) } } });
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => smtp.close(resolve));
  await db.$disconnect();
}
