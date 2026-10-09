/* Hidden-feature switches — pins the contract other files rely on:
     • middleware.ts      → hiddenFeatureForPath() decides redirect / 404
     • admin-sidebar.tsx  → isHiddenAdminHref() removes nav items
     • lib/auth.ts        → adminLanding() skips /admin/marketing when hidden
   The important part: the test reads the switches, it does NOT hard-code "false",
   so flipping a switch in lib/features.ts later keeps this suite green — only a
   wrong/typo'd path can break it. Disk checks make sure every path we hide is a
   real page/API (no silent no-op hides). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const load = loader();
const { FEATURES, HIDDEN_ADMIN_PAGES, HIDDEN_ADMIN_APIS, hiddenFeatureForPath, isHiddenAdminHref } =
  load('lib/features.ts');

const ROOT = path.resolve(__dirname, '..');
const KEYS = Object.keys(FEATURES);

/* expectation from the switch state — flips along with the flags */
const expectFor = (key, p) => (FEATURES[key] ? null : key);

test('engagement pages follow the switch', () => {
  for (const p of HIDDEN_ADMIN_PAGES.adminEngagement) {
    assert.equal(hiddenFeatureForPath(p), expectFor('adminEngagement', p), p);
  }
});

test('whatsapp pages + APIs follow the switch', () => {
  for (const p of [...HIDDEN_ADMIN_PAGES.adminWhatsapp, ...HIDDEN_ADMIN_APIS.adminWhatsapp]) {
    assert.equal(hiddenFeatureForPath(p), expectFor('adminWhatsapp', p), p);
  }
});

test('sub-routes are hidden too (token/query ashena, sudhu pathname)', () => {
  for (const p of ['/admin/whatsapp/devices', '/admin/whatsapp/compose', '/admin/whatsapp/12', '/admin/blog/some-post', '/api/wa/inbound', '/api/admin/whatsapp/qr']) {
    assert.notEqual(hiddenFeatureForPath(p), null, p);
  }
});

test('visible things stay visible (no over-blocking)', () => {
  for (const p of ['/', '/products', '/cart', '/checkout', '/blog', '/returns',
                   '/admin/dashboard', '/admin/orders', '/admin/products', '/admin/stock',
                   '/admin/coupons', '/admin/promotions', '/admin/waitlist', '/admin/customers',
                   '/admin/settings', '/admin/security', '/admin/users', '/admin/analytics',
                   '/admin/reviews', '/api/admin/reviews', '/api/admin/review-requests',
                   '/api/admin/promotions', '/api/admin/coupons', '/api/admin/settings', '/api/checkout']) {
    assert.equal(hiddenFeatureForPath(p), null, p + ' must stay visible');
    assert.equal(isHiddenAdminHref(p), false, p);
  }
});

test('no path is claimed by both switches (sidebar + middleware agree)', () => {
  for (const a of KEYS) for (const b of KEYS) {
    if (a === b) continue;
    const hit = HIDDEN_ADMIN_PAGES[a].filter((p) => HIDDEN_ADMIN_PAGES[b].includes(p));
    assert.deepEqual(hit, [], `${a} vs ${b}`);
  }
});

/* route file khuje ber kora — base dir e route.ts thakte pare, ba sub-route-e
   (e.g. /admin/whatsapp/devices = app/admin/(panel)/whatsapp/devices/page.tsx) */
const hasFile = (dir, name) => {
  if (!fs.existsSync(dir)) return false;
  if (fs.existsSync(path.join(dir, name))) return true;
  return fs.readdirSync(dir, { withFileTypes: true })
    .some((e) => e.isDirectory() && hasFile(path.join(dir, e.name), name));
};

test('every hidden page path is a real page on disk', () => {
  const missing = [];
  for (const key of KEYS) for (const p of HIDDEN_ADMIN_PAGES[key]) {
    const dir = path.join(ROOT, 'app', 'admin', '(panel)', p.replace('/admin/', ''));
    if (!hasFile(dir, 'page.tsx')) missing.push(p);
  }
  assert.deepEqual(missing, [], 'hidden path has no page — typo? ' + missing.join(', '));
});

test('every hidden API base is a real route on disk', () => {
  const missing = [];
  for (const key of KEYS) for (const p of HIDDEN_ADMIN_APIS[key]) {
    const dir = path.join(ROOT, 'app', p.replace('/api/', 'api/'));
    if (!hasFile(dir, 'route.ts')) missing.push(p);
  }
  assert.deepEqual(missing, [], 'hidden API has no route — typo? ' + missing.join(', '));
});

test('switches are plain booleans and names are stable', () => {
  assert.deepEqual(KEYS, ['adminEngagement', 'adminReviews', 'adminWhatsapp', 'adminCampaignLinks', 'adminTwoFactor', 'googleLogin', 'freeDelivery']);
  for (const k of KEYS) assert.equal(typeof FEATURES[k], 'boolean', k);
});

test('the engagement group is now 5 tools — Reviews alada (back kora hoyeche)', () => {
  assert.deepEqual(HIDDEN_ADMIN_PAGES.adminEngagement,
    ['/admin/sms', '/admin/loyalty', '/admin/marketing', '/admin/campaigns', '/admin/blog']);
  assert.deepEqual(HIDDEN_ADMIN_APIS.adminEngagement,
    ['/api/admin/sms', '/api/admin/loyalty', '/api/admin/campaigns', '/api/admin/push', '/api/admin/blog']);
  assert.deepEqual(HIDDEN_ADMIN_PAGES.adminWhatsapp, ['/admin/whatsapp', '/admin/inbox']);
});

test('reviews switch ON ⇒ Reviews page + APIs visible (owner request)', () => {
  assert.equal(FEATURES.adminReviews, true, 'Reviews abar on kora hoyeche');
  for (const p of ['/admin/reviews', '/api/admin/reviews', '/api/admin/reviews/12', '/api/admin/review-requests']) {
    assert.equal(hiddenFeatureForPath(p), null, p + ' visible hote hobe');
  }
  /* switch false korle abar hide — list ta tai rakha ache */
  assert.deepEqual(HIDDEN_ADMIN_PAGES.adminReviews, ['/admin/reviews']);
  assert.deepEqual(HIDDEN_ADMIN_APIS.adminReviews, ['/api/admin/reviews', '/api/admin/review-requests']);
});

test('campaign links page + API follow the switch', () => {
  for (const p of [...HIDDEN_ADMIN_PAGES.adminCampaignLinks, ...HIDDEN_ADMIN_APIS.adminCampaignLinks]) {
    assert.equal(hiddenFeatureForPath(p), expectFor('adminCampaignLinks', p), p);
  }
});

test('google login endpoint (callback soho) follows the switch', () => {
  for (const p of ['/api/auth/google', '/api/auth/google/callback']) {
    assert.equal(hiddenFeatureForPath(p), expectFor('googleLogin', p), p);
  }
});

test('2FA switch hides no route (login step + API nijei guard kore)', () => {
  assert.deepEqual(HIDDEN_ADMIN_PAGES.adminTwoFactor, []);
  assert.deepEqual(HIDDEN_ADMIN_APIS.adminTwoFactor, []);
  /* Security page ta thake — Sessions/log-out-everywhere er jonno */
  assert.equal(hiddenFeatureForPath('/admin/security'), null);
});

test('SWITCHES WITH NO ROUTE: googleLogin keeps the admin panel intact', () => {
  for (const p of ['/admin/dashboard', '/admin/settings', '/admin/login', '/api/auth/login', '/api/client/config']) {
    assert.equal(hiddenFeatureForPath(p), null, p);
  }
});

test('freeDelivery switch hides no route (pricing + UI nijei guard kore)', () => {
  assert.deepEqual(HIDDEN_ADMIN_PAGES.freeDelivery, []);
  assert.deepEqual(HIDDEN_ADMIN_APIS.freeDelivery, []);
  for (const p of ['/cart', '/checkout', '/returns', '/api/checkout', '/api/coupon', '/admin/settings', '/admin/coupons']) {
    assert.equal(hiddenFeatureForPath(p), null, p);
  }
});
