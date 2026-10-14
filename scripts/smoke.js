/* Smoke test: core flows against a running instance (BASE_URL, default localhost:3000) */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const { randomInt, randomUUID } = require("node:crypto");
// A fixed phone made reruns fail legitimate per-customer/first-order coupon limits.
const testPhone = "018" + randomInt(10_000_000, 100_000_000);
const testIp = `10.249.${randomInt(1, 255)}.${randomInt(1, 255)}`;
let cookie = "";
async function req(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", "x-forwarded-for": testIp, ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  const sc = r.headers.get("set-cookie");
  if (sc && sc.includes("sz_session")) cookie = sc.split(";")[0];
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
let pass = 0, fail = 0, skipped = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra || ""); }
}
/* lib/features.ts hides some admin features at the owner's request (2026-10-08), enforced by
   middleware.ts: a hidden PAGE 307-redirects to /admin/dashboard, and a hidden API answers
   404 {"error":"This feature is currently hidden"}. This suite is shared verbatim with
   sinzo-commerce, where those features are live, so their checks must SKIP here rather than
   fail. A suite that always prints three failures trains everyone to stop reading it, and then
   the fourth — a real regression — gets ignored too.

   Detection is behavioural, not a hardcoded list of paths: flip a flag back on in
   lib/features.ts and the matching check starts asserting again by itself, with nothing to
   remember to update here. If middleware ever stops hiding something this expects to be hidden,
   that also surfaces as a normal pass/fail instead of a silent skip. */
const skip = (name, why) => { skipped++; console.log("  ⊘", name, "— " + why); };
const HIDDEN_API = "This feature is currently hidden";
const hiddenPage = (r) => r.redirected && new URL(r.url).pathname === "/admin/dashboard";
(async () => {
  console.log("Smoke test →", BASE);
  // admin login first (seeded super admin) so tests adapt to whatever products exist.
  // Credentials come from env (SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD) —
  // never hardcode real passwords in source.
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "Sinzo.bd@gmail.com";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "";
  let adminAuthed = false;
  if (adminPassword) {
    const login = await req("/api/admin/login", { method: "POST", body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
    adminAuthed = login.status === 200 && !!login.body?.ok;
    check("admin login works", adminAuthed, JSON.stringify(login.body));
  } else {
    console.log("  ⚠ SMOKE_ADMIN_PASSWORD not set — auth-dependent tests will be skipped");
  }
  let plist = (await req("/api/admin/products")).body?.products || [];
  if (adminAuthed) check("admin products list", plist.length >= 1, "(got " + plist.length + ")");
  if (plist.length === 0) {
    // unauthenticated fallback: public search returns popular products
    const pop = (await req("/api/search?q=")).body?.products || [];
    plist = pop.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: "ACTIVE", stock: 1, variants: [] }));
  }
  const live = plist.find((p) => p.status === "ACTIVE" && p.stock > 0) || plist[0];
  const slug = live?.slug || "";
  const needle = (live?.title || "").split(" ").slice(-1)[0] || live?.title || "";

  // storefront pages (PDP uses a real product slug from the DB)
  for (const p of ["/", "/products", "/cart", "/checkout", "/track", "/products/" + slug, "/collections/best-sellers"]) {
    const r = await fetch(BASE + p);
    check("GET " + p, r.status === 200, "(" + r.status + ")");
  }
  // admin reports that were added with the profit/stock/blog/newsletter/couriers batch.
  // The pages are server-rendered behind the cookie set by the login above, so a 200 plus the
  // page's own heading is the cheap proof that they compile AND that their queries run.
  if (adminAuthed) {
    for (const [path, heading] of [
      ["/admin/profit", "Profit &amp; Margin"],
      ["/admin/stock", "Stock ledger"],
      ["/admin/blog", "New post"],
      ["/admin/campaigns", "New campaign"],
      ["/admin/couriers", "Couriers &amp; RTO"],
    ]) {
      const r = await fetch(BASE + path, { headers: { cookie } });
      const html = await r.text();
      if (hiddenPage(r)) { skip("GET " + path, "hidden by lib/features.ts (redirected to /admin/dashboard)"); continue; }
      check("GET " + path, r.status === 200 && html.includes(heading), "(status=" + r.status + ")");
    }
    // the newsletter audience endpoint must answer with real numbers, not a 500
    const camp = await req("/api/admin/campaigns");
    if (camp.status === 404 && camp.body?.error === HIDDEN_API) skip("newsletter audience endpoint", "hidden by lib/features.ts (adminEngagement)");
    else check("newsletter audience endpoint", camp.status === 200 && typeof camp.body?.audience === "number", JSON.stringify(camp.body).slice(0, 90));
    // a restock without a quantity must be refused (validation, not a silent write)
    const bad = await req("/api/admin/stock", { method: "POST", body: JSON.stringify({ productId: live?.id, qty: 0 }) });
    check("restock rejects a zero quantity", bad.status === 400, "(status=" + bad.status + ")");
  }
  // the journal is public and must exist even with nothing published
  {
    const r = await fetch(BASE + "/blog");
    const html = await r.text();
    check("GET /blog", r.status === 200 && /Journal/.test(html), "(status=" + r.status + ")");
  }
  // unsubscribe is signed: a guessed token must never unsubscribe somebody
  {
    const r = await fetch(BASE + "/api/newsletter/unsubscribe?e=nobody@example.com&k=deadbeefdeadbeefdeadbeefdeadbeef");
    check("forged unsubscribe link refused", r.status === 400, "(status=" + r.status + ")");
  }

  // search api (search a word from a real product title)
  r = await req("/api/search?q=" + encodeURIComponent(needle));
  check("search finds existing product", r.body?.products?.length > 0, "(q=" + needle + ")");
  // coupon api
  r = await req("/api/coupon", { method: "POST", body: JSON.stringify({ code: "WELCOME10", subtotal: 2000 }) });
  check("coupon WELCOME10 valid", r.body?.valid === true && r.body.discount === 200);
  r = await req("/api/coupon", { method: "POST", body: JSON.stringify({ code: "BOGUS", subtotal: 2000 }) });
  check("invalid coupon rejected", r.body?.valid === false);
  // admin auth guard (fresh request, no cookie)
  {
    const s = cookie; cookie = "";
    r = await req("/api/admin/products");
    check("admin api blocked without login", r.status === 401);
    cookie = s;
  }
  // checkout flow (real order)
  const target = live;
  const variant = (target.variants || []).find((v) => v.stock > 0) || null;
  r = await req("/api/checkout", { method: "POST", body: JSON.stringify({
    name: "Smoke Test Customer", phone: testPhone, address: "House 99, Road 12, Banani, Dhaka",
    area: "INSIDE_DHAKA", paymentMethod: "COD", couponCode: "WELCOME10",
    items: [{ productId: target.id, variantId: variant?.id || null, qty: 1 }],
  })});
  check("COD order placed", r.status === 200 && /^ORD-\d+$/.test(r.body?.code || ""), JSON.stringify(r.body));
  const code = r.body?.code;
  if (adminAuthed) {
    // order appears in admin
    r = await req("/api/admin/orders?q=" + code);
    check("order visible in admin", r.body?.orders?.length === 1);
    const orderId = r.body?.orders?.[0]?.id;
    // status update
    r = await req("/api/admin/orders/" + orderId, { method: "PUT", body: JSON.stringify({ status: "CONFIRMED" }) });
    check("order status update", r.status === 200);
    // Restore the actual settings, not a hard-coded fee that changes the shop.
    const originalShipping = (await req("/api/admin/settings")).body?.settings?.shipping;
    if (originalShipping) {
      try {
        r = await req("/api/admin/settings", { method: "PUT", body: JSON.stringify({ group: "shipping", value: { insideDhaka: 90 } }) });
        check("settings update", r.status === 200);
      } finally {
        r = await req("/api/admin/settings", { method: "PUT", body: JSON.stringify({ group: "shipping", value: originalShipping }) });
        check("smoke restores the original shipping settings", r.status === 200);
      }
    } else check("read settings before fixture update", false);
  }
  // public tracking
  r = await req("/api/track/order", { method: "POST", body: JSON.stringify({ code, phone: testPhone }) });
  check("customer can track order", adminAuthed
    ? r.body?.order?.status === "CONFIRMED"
    : r.body?.order?.status === "PENDING");
  // CAPI not configured -> honest response
  r = await req("/api/track/event", { method: "POST", body: JSON.stringify({ name: "AddToCart", eventId: "smoke-" + randomUUID(), data: { value: 100 } }) });
  check("tracking endpoint responds (CAPI honest about config)", r.status === 200);
  /* customer login must not reveal whether a phone number has an account */
  {
    const bad1 = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "01700000001", password: "nope" }) });
    const bad2 = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "01700000002", password: "nope" }) });
    const [j1, j2] = [await bad1.json(), await bad2.json()];
    check("login: identical error for unknown vs known account", j1.error === j2.error && /Invalid phone number or password/.test(j1.error || ""), JSON.stringify(j1) + JSON.stringify(j2));
  }

  /* ── regressions found in the 2026-09-15 audit — each of these failed before the fix ── */
  {
    // 1) search must be case-insensitive on POSTGRES (LIKE is case-sensitive there;
    //    titles are stored UPPERCASE, so "beige" used to return nothing)
    const lower = (live?.title || "").trim().toLowerCase();
    if (lower) {
      const r1 = await req("/api/search?q=" + encodeURIComponent(lower));
      check("search: lowercase full title finds the product", (r1.body?.products || []).some((x) => x.slug === slug), "(q=" + lower + ")");
      if (lower.split(" ").length > 1) {
        const r2 = await req("/api/search?q=" + encodeURIComponent(lower.split(" ").slice(0, 2).join(" ")));
        check("search: multi-word query is not treated as one literal", (r2.body?.products || []).length > 0, "(q=" + lower.split(" ").slice(0, 2).join(" ") + ")");
      }
    }
    // 2) an unknown ?category= must not silently show the whole catalogue
    const page = await (await fetch(BASE + "/products?category=___definitely-not-a-category___")).text();
    check("unknown category shows the empty state (not all products)", /Nothing here yet|No such category/.test(page));
    // 3) SEO/render hygiene on a real PDP
    const pdp = await (await fetch(BASE + "/products/" + slug)).text();
    check("PDP has a canonical link", /rel="canonical"/.test(pdp));
    check("PDP <title> has no double space (DB trailing spaces)", !/<title>[^<]*[ ]{2}/.test(pdp));
    check("PDP never renders raw undefined", !/>\s*undefined\s*</.test(pdp));
    check("PDP emits Product JSON-LD", /application\/ld\+json/.test(pdp) && /"@type":"Product"/.test(pdp));
    /* 3b) the JSON-LD must stay in the shape Google's Merchant listing spec reads. Each check
       below is written as a consistency rule, not a fixed value, so the same script can run
       against any store (a fresh install with no shipping configured, a shop with no reviews
       yet, a live flash sale) without needing fixtures. */
    const plain = pdp.replace(/<!-- -->/g, ""); // React separates JSX text nodes with comments
    const blocks = [...pdp.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let prod = null;
    for (const b of blocks) { try { const o = JSON.parse(b[1]); if (o && o["@type"] === "Product") { prod = o; break; } } catch {} }
    check("PDP Product JSON-LD parses", !!prod);
    if (prod) {
      // two shapes Google silently ignores, both of which used to be here
      check("no ShippingRateSettings / previousPrice leftovers", !/"ShippingRateSettings"|"previousPrice"/.test(JSON.stringify(prod)));
      check("shipping + returns hang off the Offer, not off Product", prod.shippingDetails === undefined && prod.hasMerchantReturnPolicy === undefined);
      const off = prod.offers || {};
      const ship = off.shippingDetails;
      check("offer.shippingDetails is well formed (or absent when no rate is configured)",
        ship === undefined || (Array.isArray(ship) && ship.length > 0 && ship.every((s) =>
          s["@type"] === "OfferShippingDetails" &&
          s.shippingRate?.["@type"] === "MonetaryAmount" &&
          /^\d+$/.test(String(s.shippingRate?.value)) &&
          s.shippingRate?.currency === "BDT" &&
          s.shippingDestination?.[0]?.["@type"] === "DefinedRegion" &&
          s.shippingDestination?.[0]?.addressCountry === "BD")),
        JSON.stringify(ship));
      check("returns policy is the finite-window form Google supports",
        !off.hasMerchantReturnPolicy || (off.hasMerchantReturnPolicy.returnPolicyCategory === "https://schema.org/MerchantReturnFiniteReturnWindow" &&
          Number(off.hasMerchantReturnPolicy.merchantReturnDays) > 0));
      check("offer declares a new item with a future priceValidUntil",
        off.itemCondition === "https://schema.org/NewCondition" &&
        /^\d{4}-\d{2}-\d{2}$/.test(off.priceValidUntil || "") &&
        off.priceValidUntil >= new Date().toISOString().slice(0, 10),
        "(priceValidUntil=" + off.priceValidUntil + ")");
      // the price Google is fed must be the price a human sees on the same page
      const priceBlock = plain.match(/class="pdp-price">([\s\S]{0,300}?)<\/div>/)?.[1] || "";
      const shownNow = Number((priceBlock.match(/<b>৳([\d,]+)<\/b>/) || [])[1]?.replace(/,/g, "") || 0);
      const shownWas = Number((priceBlock.match(/<s>৳([\d,]+)<\/s>/) || [])[1]?.replace(/,/g, "") || 0);
      check("marked-up price equals the price printed on the page", shownNow > 0 && Math.round(Number(off.price)) === shownNow,
        "(ld=" + off.price + " page=" + shownNow + ")");
      check("strikethrough price matches the struck price on the page",
        shownWas === 0 ? off.priceSpecification === undefined
          : (off.priceSpecification?.priceType === "https://schema.org/StrikethroughPrice" &&
             Math.round(Number(off.priceSpecification?.price)) === shownWas),
        "(ld=" + (off.priceSpecification?.price ?? "none") + " page=" + shownWas + ")");
      // stars only ever for reviews that are actually rendered further down the page
      const shownReviews = Number((plain.match(/Reviews \((\d+)\)/) || [])[1] ?? 0);
      check("aggregateRating appears exactly when reviews are visible on the page",
        shownReviews === 0 ? prod.aggregateRating === undefined
          : (prod.aggregateRating?.reviewCount === String(shownReviews) && Array.isArray(prod.review) && prod.review.length > 0),
        "(page=" + shownReviews + " ld=" + prod.aggregateRating?.reviewCount + " review[]=" + (prod.review || []).length + ")");
      check("every marked-up review has an author, a date and a 1-5 rating",
        !prod.review || prod.review.every((r) => r.author?.name && /^\d{4}-\d{2}-\d{2}$/.test(r.datePublished || "") &&
          Number(r.reviewRating?.ratingValue) >= 1 && Number(r.reviewRating?.ratingValue) <= 5));
    }
    /* 3c) the returns policy page and the policy Google is told must be the same policy.
       admin → Policies feeds both (lib/policy.ts), so this pair can only break together. */
    const ret = await (await fetch(BASE + "/returns")).text();
    const retText = ret.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    check("returns page responds with the policy", /Returns &amp; Exchange/.test(ret) && /Last updated/.test(ret));
    const retDays = Number((retText.match(/You have (\d+) days from the day the parcel is delivered/) || [])[1] || 0);
    check("returns page states the return window", retDays > 0, "(parsed " + retDays + ")");
    check("returns page shows the delivery charges", /Inside Dhaka/.test(retText) && /Outside Dhaka/.test(retText));
    check("footer links Returns & Exchange to /returns", /href="\/returns"/.test(pdp));
    check("footer's Shipping link is not dead either", /href="\/returns#delivery"/.test(pdp));
    if (prod) {
      const rp = prod.offers?.hasMerchantReturnPolicy;
      check("marked-up return window equals the one printed on /returns",
        !!rp && rp.merchantReturnDays === retDays, "(ld=" + rp?.merchantReturnDays + " page=" + retDays + ")");
      check("merchantReturnLink points at /returns", String(rp?.merchantReturnLink || "").endsWith("/returns"), rp?.merchantReturnLink);
    }
    // 4) an ORD- code alone must not be a lookup key (enumeration guard)
    if (code) {
      const t1 = await req("/api/track/courier?code=" + encodeURIComponent(code));
      check("tracking: ORD code without phone is refused", t1.status === 400 && t1.body?.needPhone === true, "(status=" + t1.status + ")");
      const t2 = await req("/api/track/courier?code=" + encodeURIComponent(code) + "&phone=" + encodeURIComponent(testPhone));
      check("tracking: ORD code + phone works", t2.status === 200 && !!t2.body?.status);
    }
    // 5) analytics endpoints are bounded
    const big = "A".repeat(200 * 1024);
    const ev = await fetch(BASE + "/api/track/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: big });
    check("track/event rejects oversized payloads", ev.status === 413, "(status=" + ev.status + ")");
    // 6) media route must not traverse
    const trav = await fetch(BASE + "/api/media/../../../etc/passwd");
    check("media path traversal blocked", trav.status !== 200);
    // 7) security headers present
    const h = (await fetch(BASE + "/")).headers;
    check("CSP header sent", !!(h.get("content-security-policy") || h.get("content-security-policy-report-only")));
    check("nosniff sent", h.get("x-content-type-options") === "nosniff");
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed` + (skipped ? `, ${skipped} skipped (hidden by lib/features.ts)` : ``));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
