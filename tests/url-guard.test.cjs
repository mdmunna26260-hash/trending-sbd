/* Regression tests for lib/url-guard.ts — the /l/<slug> campaign redirect.

   Before this, the only check on WaLink.target was /^https?:\/\//, so the shop's own
   domain served a 302 to any http(s) URL: an open redirect on a host customers already
   trust, reachable from a WhatsApp campaign link. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const SITE = 'https://sinzooffcial.com';
const REQ = SITE + '/l/sale';
const opts = (over = {}) => ({ requestUrl: REQ, siteOrigin: SITE, ...over });

const { safeExternalTarget, isSameOriginPath } = loader()('lib/url-guard.ts');

test('same-origin targets are allowed', () => {
  assert.equal(safeExternalTarget('https://sinzooffcial.com/products/x', opts()), 'https://sinzooffcial.com/products/x');
  assert.equal(safeExternalTarget('https://sinzooffcial.com/products/x?a=1&b=2', opts()), 'https://sinzooffcial.com/products/x?a=1&b=2');
});

test('relative paths stay relative and resolve against the request', () => {
  assert.equal(safeExternalTarget('/products/x', opts()), SITE + '/products/x');
  assert.equal(safeExternalTarget('/products/x?size=M', opts()), SITE + '/products/x?size=M');
  // without a requestUrl the path is returned as-is rather than rejected
  assert.equal(safeExternalTarget('/products/x', { siteOrigin: SITE }), '/products/x');
});

test('the default allow-list covers the WhatsApp destinations a campaign needs', () => {
  assert.ok(safeExternalTarget('https://wa.me/8801700000000', opts()));
  assert.ok(safeExternalTarget('https://api.whatsapp.com/send?phone=8801700000000', opts()));
  assert.ok(safeExternalTarget('https://chat.whatsapp.com/AbCdEf', opts()));
});

test('arbitrary off-site targets are refused', () => {
  for (const evil of [
    'https://evil.example.com/phish',
    'http://evil.example.com/',
    'https://sinzooffcial.com.evil.example.com/',   // suffix trick, not a subdomain
    'https://evilsinzooffcial.com/',
    'https://wa.me.evil.example.com/',              // allowed host used as a label
    'https://user:pass@evil.example.com/',
    'ftp://evil.example.com/x',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://evil/x',
  ]) {
    assert.equal(safeExternalTarget(evil, opts()), null, `${evil} should have been refused`);
  }
});

test('protocol-relative URLs cannot leave the site', () => {
  // "//host" resolves against the request base, so it must be rejected before URL() sees it.
  assert.equal(safeExternalTarget('//evil.example.com/x', opts()), null);
  assert.equal(safeExternalTarget('///evil.example.com/x', opts()), null);
  assert.equal(safeExternalTarget('/\\evil.example.com', opts()), null);
  assert.equal(safeExternalTarget('\\evil.example.com', opts()), null);
});

test('control characters cannot hide a scheme', () => {
  assert.equal(safeExternalTarget('java\u0000script:alert(1)', opts()), null);
  assert.equal(safeExternalTarget('https://evil.example.com\u0000.sinzooffcial.com', opts()), null);
  assert.equal(safeExternalTarget('\u0001https://sinzooffcial.com/', opts()), null);
});

test('junk and oversized input is refused', () => {
  for (const bad of [null, undefined, '', '   ', 'not a url', 42, {}, 'https://' + 'a'.repeat(3000) + '.com/']) {
    assert.equal(safeExternalTarget(bad, opts()), null, `${JSON.stringify(bad)} should have been refused`);
  }
});

test('a malformed NEXT_PUBLIC_SITE_URL cannot widen the allow-list', () => {
  assert.equal(safeExternalTarget('https://evil.example.com/', opts({ siteOrigin: 'not-a-url' })), null);
  assert.equal(safeExternalTarget('https://evil.example.com/', opts({ siteOrigin: '' })), null);
});

test('REDIRECT_ALLOWLIST extends the allow-list to hosts and subdomains only', () => {
  const load = loader({}, { NODE_ENV: 'test', REDIRECT_ALLOWLIST: 'facebook.com, https://instagram.com' });
  const { safeExternalTarget: allowlisted } = load('lib/url-guard.ts');
  assert.ok(allowlisted('https://www.facebook.com/sinzo', opts()));
  assert.ok(allowlisted('https://m.facebook.com/sinzo', opts()));
  assert.ok(allowlisted('https://instagram.com/sinzo', opts()));
  // exact-host matching, not substring matching
  assert.equal(allowlisted('https://facebook.com.evil.example.com/', opts()), null);
  assert.equal(allowlisted('https://notfacebook.com/', opts()), null);
  // something not on the list is still refused
  assert.equal(allowlisted('https://evil.example.com/', opts()), null);
});

test('isSameOriginPath accepts only internal navigation', () => {
  assert.ok(isSameOriginPath('/admin/dashboard'));
  assert.ok(isSameOriginPath('/products/x?size=M'));
  assert.ok(!isSameOriginPath('//evil.example.com'));
  assert.ok(!isSameOriginPath('https://evil.example.com'));
  assert.ok(!isSameOriginPath('/\\evil.example.com'));
  assert.ok(!isSameOriginPath(''));
  assert.ok(!isSameOriginPath(null));
});
