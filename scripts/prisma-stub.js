"use strict";
/* ------------------------------------------------------------------
 * In-memory PrismaClient stub for local dev of sinzo-commerce.
 * Loaded instead of a real Prisma engine binary so the app boots
 * without `prisma generate` or a running Postgres/SQLite DB.
 * Seeds 16 products, 8 categories, 2 collections, reviews, blog,
 * and one Super Admin user whose bcrypt-hashed password is "demo".
 *
 * DO NOT use in production — this is a dev-only shim.
 * ------------------------------------------------------------------ */
const crypto = require("crypto");
const bcryptHash = "$2a$10$XBKXF/c5MWpv8KBxMfmv3.lJPRxaFPxp0J1HMRzQ.pR1y81owcany"; // demo

const uid = (() => { let n = 1; return () => n++; })();
// Real Prisma returns DateTime columns as JS Date objects — pages call
// `.toISOString()` on them and range filters compare them with `gte`/`lt` Dates.
// Returning ISO strings here crashed /admin/orders and silently broke date filters.
const iso = (d) => new Date(d);
const now = new Date();

function matchWhere(r, w) {
  if (!w) return true;
  for (const k of Object.keys(w)) {
    const v = w[k];
    if (k === "AND") return (Array.isArray(v) ? v : [v]).every(x => matchWhere(r, x));
    if (k === "OR") return (Array.isArray(v) ? v : [v]).some(x => matchWhere(r, x));
    if (k === "NOT") return !matchWhere(r, v);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("equals" in v && r[k] !== v.equals) return false;
      if ("not" in v && r[k] === v.not) return false;
      if ("in" in v && !v.in.includes(r[k])) return false;
      if ("notIn" in v && v.notIn.includes(r[k])) return false;
      if ("contains" in v && !(typeof r[k] === "string" && r[k].toLowerCase().includes(String(v.contains).toLowerCase()))) return false;
      if ("startsWith" in v && !(typeof r[k] === "string" && r[k].startsWith(v.startsWith))) return false;
      if ("endsWith" in v && !(typeof r[k] === "string" && r[k].endsWith(v.endsWith))) return false;
      if ("gt" in v && !(r[k] > v.gt)) return false;
      if ("gte" in v && !(r[k] >= v.gte)) return false;
      if ("lt" in v && !(r[k] < v.lt)) return false;
      if ("lte" in v && !(r[k] <= v.lte)) return false;
      continue;
    }
    if (r[k] !== v) return false;
  }
  return true;
}
function orderRows(rs, o) {
  if (!o) return rs;
  const a = Array.isArray(o) ? o : [o];
  return [...rs].sort((x, y) => {
    for (const q of a) for (const k of Object.keys(q)) {
      const d = q[k] === "desc" ? -1 : 1;
      if (x[k] === y[k]) continue;
      if (x[k] == null) return 1;
      if (y[k] == null) return -1;
      return x[k] < y[k] ? -1 * d : 1 * d;
    }
    return 0;
  });
}

const data = {
  user: [{ id: 1, email: "admin@sinzo.dev", password: bcryptHash, name: "Admin", role: "SUPER_ADMIN", active: true, twoFactorSecret: null, twoFactorEnabled: false, sessionVersion: 0, recoveryCodes: null, resetToken: null, resetTokenExpires: null, createdAt: iso(now) }],
  setting: (() => {
    const e = {
      store: { name: "TRENDING'S", tagline: "Shop online, pay on delivery", about: "Premium fashion delivered across Bangladesh. Cash on delivery, 7-day returns.", email: "hello@sinzo.dev", phone: "+8801700000000", address: "Dhaka, Bangladesh", logo: "", currency: "BDT" },
      theme: { mode: "light", accent: "#b98a5e" },
      shipping: { insideDhaka: 60, outsideDhaka: 120, freeShippingThreshold: 2500, estimateInside: "24h", estimateOutside: "48-72h" },
      homepage: { featuredCollection: "new-arrivals", bestSellersCollection: "best-sellers", heroTitle: "New Season. New You.", heroSubtitle: "Handpicked pieces crafted for everyday confidence.", heroCtaLabel: "Shop Now", heroCtaHref: "/products" },
      checkout: { allowCod: true, minOrder: 300, maxOrder: 50000 },
      seo: { metaTitle: "TRENDING'S - Shop online, pay on delivery", metaDescription: "Trendy fashion delivered across Bangladesh with cash on delivery.", ogImage: "/uploads/seed/hero.jpg" },
      integrations: {},
      maintenance: { enabled: false },
    };
    return Object.keys(e).map(k => ({ key: k, value: JSON.stringify(e[k]) }));
  })(),
  category: [
    { id: 1, name: "Shirts", slug: "shirts", description: "Crisp everyday shirts", image: "/uploads/seed/p-shirt-600.webp" },
    { id: 2, name: "T-Shirts", slug: "t-shirts", description: "Premium tees", image: "/uploads/seed/p-tee-600.webp" },
    { id: 3, name: "Outerwear", slug: "outerwear", description: "Coats & jackets", image: "/uploads/seed/p-coat-600.webp" },
    { id: 4, name: "Dresses", slug: "dresses", description: "Effortless dresses", image: "/uploads/seed/p-dress-600.webp" },
    { id: 5, name: "Bottoms", slug: "bottoms", description: "Denim & trousers", image: "/uploads/seed/p-denim-600.webp" },
    { id: 6, name: "Knitwear", slug: "knitwear", description: "Soft knits", image: "/uploads/seed/p-knit-600.webp" },
    { id: 7, name: "Accessories", slug: "accessories", description: "Bags & extras", image: "/uploads/seed/p-bag-600.webp" },
    { id: 8, name: "Trousers", slug: "trousers", description: "Tailored trousers", image: "/uploads/seed/p-trousers-600.webp" },
  ],
  collection: [
    { id: 1, title: "New Arrivals", slug: "new-arrivals", subtitle: "Fresh drops", image: null, createdAt: iso(now) },
    { id: 2, title: "Best Sellers", slug: "best-sellers", subtitle: "Loved by you", image: null, createdAt: iso(now) },
  ],
  collectionProduct: [],
  colorGroup: [],
  product: [],
  productImage: [],
  productVariant: [],
  review: [],
  customer: [],
  order: [],
  orderItem: [],
  coupon: [],
  notification: [],
  waitlist: [],
  media: [{ id: "cseed0", filename: "hero.jpg", mime: "image/jpeg", size: 0, data: null, width: 1200, height: 1600, blurData: null, variantsJson: null, createdAt: iso(now) }],
  blogPost: [{ id: 1, title: "Style guide: building your first capsule wardrobe", slug: "capsule-wardrobe", excerpt: "Five versatile pieces.", content: "Start with neutral basics", image: "/uploads/seed/p-knit-600.webp", published: true, createdAt: iso(new Date(now - 7 * 86400000)), updatedAt: iso(new Date(now - 7 * 86400000)) }],
  waDevice: [], waTemplate: [], waMessage: [], waBroadcast: [], waLink: [], waOptOut: [],
  abandonedCheckout: [], auditLog: [], inventoryMovement: [], blacklist: [], payment: [],
  inboxMessage: [], appLog: [], subscriber: [], campaign: [], trackingEvent: [], pushSubscription: [],
};

const PD = [
  { t: "Oxford Cotton Shirt", s: "oxford-cotton-shirt", p: 1490, c: 1890, cat: 1, i: "shirt", b: "NEW", n: 1, bs: 0, sz: ["S", "M", "L", "XL"] },
  { t: "Linen Relaxed Shirt", s: "linen-relaxed-shirt", p: 1690, c: null, cat: 1, i: "shirt", b: null, n: 0, bs: 1, sz: ["M", "L", "XL"] },
  { t: "Classic Crew Tee", s: "classic-crew-tee", p: 690, c: 890, cat: 2, i: "tee", b: "HOT", n: 0, bs: 1, sz: ["S", "M", "L", "XL"] },
  { t: "Oversized Graphic Tee", s: "oversized-graphic-tee", p: 890, c: null, cat: 2, i: "tee", b: null, n: 1, bs: 0, sz: ["M", "L", "XL"] },
  { t: "Wool Blend Coat", s: "wool-blend-coat", p: 4290, c: 5490, cat: 3, i: "coat", b: "SALE", n: 0, bs: 1, sz: ["M", "L"] },
  { t: "Cropped Puffer Jacket", s: "cropped-puffer-jacket", p: 2890, c: null, cat: 3, i: "coat", b: "NEW", n: 1, bs: 0, sz: ["S", "M", "L"] },
  { t: "Midi Slip Dress", s: "midi-slip-dress", p: 1990, c: 2490, cat: 4, i: "dress", b: "SALE", n: 0, bs: 1, sz: ["S", "M", "L"] },
  { t: "Summer Floral Dress", s: "summer-floral-dress", p: 2290, c: null, cat: 4, i: "dress", b: "NEW", n: 1, bs: 0, sz: ["S", "M", "L"] },
  { t: "High-Waist Denim", s: "high-waist-denim", p: 1790, c: null, cat: 5, i: "denim", b: null, n: 0, bs: 1, sz: ["28", "30", "32", "34"] },
  { t: "Wide-Leg Jeans", s: "wide-leg-jeans", p: 1890, c: 2190, cat: 5, i: "denim", b: null, n: 1, bs: 0, sz: ["28", "30", "32"] },
  { t: "Cashmere Blend Knit", s: "cashmere-blend-knit", p: 2490, c: null, cat: 6, i: "knit", b: "LUXE", n: 0, bs: 1, sz: ["S", "M", "L"] },
  { t: "Chunky Cable Sweater", s: "chunky-cable-sweater", p: 2190, c: null, cat: 6, i: "knit", b: null, n: 1, bs: 0, sz: ["S", "M", "L", "XL"] },
  { t: "Leather Crossbody Bag", s: "leather-crossbody-bag", p: 1590, c: 1990, cat: 7, i: "bag", b: "SALE", n: 0, bs: 1, sz: ["Free"] },
  { t: "Canvas Tote", s: "canvas-tote", p: 590, c: null, cat: 7, i: "bag", b: null, n: 1, bs: 0, sz: ["Free"] },
  { t: "Pleated Trousers", s: "pleated-trousers", p: 1890, c: null, cat: 8, i: "trousers", b: null, n: 0, bs: 1, sz: ["30", "32", "34"] },
  { t: "Slim Fit Chinos", s: "slim-fit-chinos", p: 1390, c: 1690, cat: 8, i: "trousers", b: null, n: 1, bs: 0, sz: ["30", "32", "34"] },
];
let pid = 0;
PD.forEach((x, j) => {
  const id = ++pid;
  const imgs = [
    { id: uid(), url: `/uploads/seed/p-${x.i}-600.webp`, alt: x.t, position: 0, productId: id },
    { id: uid(), url: `/uploads/seed/p-${x.i}-800.webp`, alt: x.t, position: 1, productId: id },
  ];
  data.productImage.push(...imgs);
  const vs = x.sz.map((sz, k) => ({
    id: uid(), size: sz, color: ["Black", "White", "Beige", "Navy", "Olive"][k % 5],
    sku: `SKU-${id}-${k + 1}`, price: x.p, stock: 5 + ((j * 7 + k) % 20), barcode: null, productId: id, image: imgs[0].url,
  }));
  data.productVariant.push(...vs);
  data.product.push({
    id, title: x.t, slug: x.s, shortDesc: "", description: "", sku: `SKU-${id}`, barcode: null,
    price: x.p, comparePrice: x.c, cost: Math.round(x.p * 0.55),
    stock: vs.reduce((s, v) => s + v.stock, 0), lowStock: 3, status: "ACTIVE", featured: j < 8, tags: null,
    categoryId: x.cat, views: 100 + j * 17, position: j, sizeChartImage: null,
    soldCount: x.bs ? 80 + j * 4 : 10 + j, saleEnds: null, preorder: false, preorderDate: null, soldMode: "fixed",
    badge: x.b, isNew: !!x.n, isBestSeller: !!x.bs, colorGroupId: null, colorName: null, colorImage: null,
    createdAt: iso(new Date(now - (j + 3) * 86400000)), updatedAt: iso(new Date(now - j * 3600000)),
  });
});
data.collectionProduct.push(...data.product.filter(p => p.isNew).map(p => ({ collectionId: 1, productId: p.id })));
data.collectionProduct.push(...data.product.filter(p => p.isBestSeller).map(p => ({ collectionId: 2, productId: p.id })));

const rt = ["Quality is amazing!", "Loved the fabric, will buy again.", "Super fast delivery!", "Exactly as described. 10/10.", "Comfortable and stylish."];
const rn = ["Riya", "Tanvir", "Nadia", "Ashik", "Sumi", "Farhan", "Meem", "Imran", "Zara", "Rafi"];
data.product.slice(0, 10).forEach((p, i) => data.review.push({
  id: uid(), productId: p.id, name: rn[i % 10], phone: `+88017000000${i + 10}`,
  rating: 4 + (i % 2), text: rt[i % rt.length], photos: null, status: "APPROVED", verified: true,
  featured: i < 3, createdAt: iso(new Date(now - i * 2 * 86400000)),
}));

function ps(r, s) { const o = {}; for (const k of Object.keys(s)) { if (s[k] === true || typeof s[k] !== "object") o[k] = r[k]; else o[k] = void 0; } return o; }
const tmt = {
  images: { t: () => data.productImage, fk: "productId" },
  variants: { t: () => data.productVariant, fk: "productId" },
  reviews: { t: () => data.review, fk: "productId" },
  orderItems: { t: () => data.orderItem, fk: "orderId" },
  items: { t: () => data.orderItem, fk: "orderId" },
  orders: { t: () => data.order, fk: "customerId" },
  payments: { t: () => data.payment, fk: "orderId" },
  movements: { t: () => data.inventoryMovement, fk: "productId" },
  collectionProduct: { t: () => data.collectionProduct, fk: "productId" },
};
function rr(r, k, v) {
  if (data[k]) {
    const fk = k + "Id";
    const x = r[fk] != null ? data[k].find(y => y.id === r[fk]) : null;
    return x ? sx(x, v && v.include, v && v.select) : null;
  }
  if (k === "products") {
    let rs = data.collectionProduct.filter(cp => cp.collectionId === r.id).map(cp => {
      const p = data.product.find(y => y.id === cp.productId);
      if (!p) return null;
      const o = { ...cp };
      if (v && v.select && v.select.product) o.product = sx(p, v.select.product.include, v.select.product.select);
      else o.product = p;
      return o;
    }).filter(Boolean);
    if (typeof v === "object") {
      if (v.where) rs = rs.filter(x => matchWhere(x, v.where));
      if (v.orderBy) rs = orderRows(rs, v.orderBy);
      if (v.skip) rs = rs.slice(v.skip);
      if (v.take) rs = rs.slice(0, v.take);
    }
    return rs;
  }
  if (k === "product" && r.productId != null) {
    const p = data.product.find(x => x.id === r.productId);
    return p ? sx(p, v && v.include, v && v.select) : null;
  }
  const rel = tmt[k];
  if (rel) {
    let rs = rel.t().filter(x => x[rel.fk] === r.id);
    if (typeof v === "object") {
      if (v.where) rs = rs.filter(x => matchWhere(x, v.where));
      if (v.orderBy) rs = orderRows(rs, v.orderBy);
      if (v.skip) rs = rs.slice(v.skip);
      if (v.take) rs = rs.slice(0, v.take);
      if (v.select) rs = rs.map(x => sx(x, null, v.select));
    }
    return rs;
  }
}
// `include/select: { _count: { select: { products: true } } }` → { _count: { products: n } }
function countRel(r, k) {
  if (k === "products") {
    if (data.category.includes(r)) return data.product.filter(p => p.categoryId === r.id).length;
    return data.collectionProduct.filter(cp => cp.collectionId === r.id).length;
  }
  const rel = tmt[k];
  return rel ? rel.t().filter(x => x[rel.fk] === r.id).length : 0;
}
function cnt(r, v) {
  const keys = v && typeof v === "object" && v.select ? Object.keys(v.select).filter(k => v.select[k]) : [];
  const o = {};
  for (const k of keys) o[k] = countRel(r, k);
  return o;
}
function sx(r, inc, sel) {
  const b = sel ? ps(r, sel) : Object.assign({}, r);
  if (inc && inc._count) b._count = cnt(r, inc._count);
  if (sel && sel._count) b._count = cnt(r, sel._count);
  if (inc) for (const k of Object.keys(inc)) {
    if (!inc[k] || k === "_count") continue;
    const v = rr(r, k, inc[k]);
    if (v !== void 0) b[k] = v;
  }
  if (sel) for (const k of Object.keys(sel)) {
    if (k !== "_count" && sel[k] && typeof sel[k] === "object") {
      const v = rr(r, k, sel[k]);
      if (v !== void 0) b[k] = v;
    }
  }
  return b;
}
// Apply Prisma atomic update operators ({ increment, decrement, set, push, ... })
// when patching a row. Without this, `stock: { increment: n }` gets Object.assign'd
// onto the record and later rendered into JSX as [object Object] — causing the
// "Objects are not valid as a React child (found: object with keys {increment})" crash.
function applyAtomicOps(row, patch) {
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === "object" && !Array.isArray(v) && v instanceof Date === false) {
      if ("increment" in v) row[k] = Number(row[k] || 0) + Number(v.increment || 0);
      else if ("decrement" in v) row[k] = Number(row[k] || 0) - Number(v.decrement || 0);
      else if ("set" in v) row[k] = v.set;
      else if ("push" in v) row[k] = [...(Array.isArray(row[k]) ? row[k] : []), ...(Array.isArray(v.push) ? v.push : [v.push])];
      else if ("unset" in v) delete row[k];
      else row[k] = v; // unknown operator — keep as-is (won't happen on hot paths)
    } else {
      row[k] = v;
    }
  }
}
function mkDel(m) {
  const t = data[m];
  const defaultsFor = (model) => {
    if (model === "subscriber") return { unsubscribed: false, unsubscribedAt: null, createdAt: iso(now) };
    if (model === "customer") return { createdAt: iso(now), points: 0 };
    if (model === "campaign") return { total: 0, sent: 0, failed: 0, status: "DRAFT", createdAt: iso(now) };
    if (model === "order") return { createdAt: new Date(), updatedAt: new Date() };
    if (model === "product") return { createdAt: iso(now), updatedAt: iso(now) };
    // every other model: mirror Prisma's `createdAt @default(now())` / `@updatedAt`
    // (audit log, tracking events, system logs … crashed on `.createdAt.toISOString()`)
    return { createdAt: new Date(), updatedAt: new Date() };
  };
  const a = {
    findMany(q = {}) {
      let rs = t.filter(r => matchWhere(r, q.where));
      if (q.orderBy) rs = orderRows(rs, q.orderBy);
      if (q.skip) rs = rs.slice(q.skip);
      if (q.take) rs = rs.slice(0, q.take);
      return Promise.resolve(rs.map(r => sx(r, q.include, q.select)));
    },
    findUnique(q) { return a.findFirst(q); },
    findUniqueOrThrow(q) { return a.findFirst(q).then(r => { if (!r) throw new Error("NF"); return r; }); },
    findFirst(q = {}) {
      let rs = t.filter(r => matchWhere(r, q.where || {}));
      if (q.orderBy) rs = orderRows(rs, q.orderBy);
      const r = rs[0] || null;
      return Promise.resolve(r ? sx(r, q.include, q.select) : null);
    },
    findFirstOrThrow(q) { return a.findFirst(q).then(r => { if (!r) throw new Error("NF"); return r; }); },
    count(q = {}) { return Promise.resolve(t.filter(r => matchWhere(r, q.where || {})).length); },
    create(q) {
      const r = { ...defaultsFor(m), ...q.data };
      if (!r.id) {
        if (m === "media") r.id = "c" + crypto.randomBytes(8).toString("hex").slice(0, 14);
        else r.id = (t.reduce((x, y) => Math.max(x, y.id || 0), 0) || 0) + 1;
      }
      // nested writes: `items: { create: [...] }` → rows in the child table
      for (const k of Object.keys(r)) {
        const v = r[k], rel = tmt[k];
        if (rel && v && typeof v === "object" && !Array.isArray(v) && "create" in v) {
          const kids = Array.isArray(v.create) ? v.create : [v.create];
          const tbl = rel.t();
          for (const kid of kids) tbl.push({ id: (tbl.reduce((x, y) => Math.max(x, y.id || 0), 0) || 0) + 1, ...kid, [rel.fk]: r.id });
          delete r[k];
        }
      }
      t.push(r);
      return Promise.resolve(sx(r, q.include, q.select));
    },
    createMany(q) { let c = 0; for (const d of (q.data || [])) { a.create({ data: d }); c++; } return Promise.resolve({ count: c }); },
    update(q) {
      const i = t.findIndex(r => matchWhere(r, q.where));
      if (i < 0) return Promise.resolve(null);
      applyAtomicOps(t[i], q.data || {});
      if (m === "product") t[i].updatedAt = iso(now);
      return Promise.resolve(sx(t[i], q.include, q.select));
    },
    updateMany(q) {
      let c = 0; t.forEach(r => { if (matchWhere(r, q.where)) { applyAtomicOps(r, q.data || {}); c++; } });
      return Promise.resolve({ count: c });
    },
    upsert(q) {
      const e = t.find(r => matchWhere(r, q.where));
      if (e) {
        // Prisma upsert passes update payload in q.update (not q.data)
        const upd = ("data" in q) ? q.data : q.update;
        const patched = { ...q, data: upd };
        return a.update(patched);
      }
      return a.create({ data: q.create });
    },
    delete(q) { const i = t.findIndex(r => matchWhere(r, q.where)); if (i < 0) return Promise.resolve(null); const [r] = t.splice(i, 1); return Promise.resolve(r); },
    deleteMany(q = {}) { let c = 0; for (let i = t.length - 1; i >= 0; i--) if (matchWhere(t[i], q.where || {})) { t.splice(i, 1); c++; } return Promise.resolve({ count: c }); },
    aggregate(q = {}) {
      const rs = t.filter(r => matchWhere(r, q.where || {}));
      const _c = { _all: rs.length };
      if (q._count) for (const k of Object.keys(q._count)) _c[k] = rs.length;
      const res = { _count: _c };
      if (q._sum) { res._sum = {}; for (const k of Object.keys(q._sum)) res._sum[k] = rs.reduce((s, r) => s + (Number(r[k]) || 0), 0); }
      if (q._avg) { res._avg = {}; for (const k of Object.keys(q._avg)) res._avg[k] = rs.length ? rs.reduce((s, r) => s + (Number(r[k]) || 0), 0) / rs.length : 0; }
      if (q._min && rs.length) { res._min = {}; for (const k of Object.keys(q._min)) res._min[k] = rs.reduce((x, r) => r[k] < x ? r[k] : x, rs[0][k]); }
      if (q._max && rs.length) { res._max = {}; for (const k of Object.keys(q._max)) res._max[k] = rs.reduce((x, r) => r[k] > x ? r[k] : x, rs[0][k]); }
      return Promise.resolve(res);
    },
    groupBy(q) {
      const rs = t.filter(r => matchWhere(r, q.where || {}));
      const g = new Map();
      for (const r of rs) {
        const k = q.by.map(x => r[x]).join("|");
        if (!g.has(k)) g.set(k, { ...Object.fromEntries(q.by.map(x => [x, r[x]])), _count: {}, _sum: {} });
        const e = g.get(k); e._count._all = (e._count._all || 0) + 1;
        if (q._count) for (const x of Object.keys(q._count)) e._count[x] = (e._count[x] || 0) + 1;
        if (q._sum) for (const x of Object.keys(q._sum)) e._sum[x] = (e._sum[x] || 0) + (Number(r[x]) || 0);
      }
      return Promise.resolve([...g.values()]);
    },
  };
  return new Proxy(a, { get(t, p) { return p in t ? t[p] : () => Promise.resolve(null); } });
}
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(_, p) {
        if (p === "$connect" || p === "$disconnect" || p === "$on" || p === "$use") return () => Promise.resolve();
        if (p === "$transaction") return arg => Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? arg(new PrismaClient()) : Promise.resolve();
        if (["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe", "$runCommandRaw"].includes(p)) return () => Promise.resolve([]);
        if (data[p]) return mkDel(p);
        return void 0;
      },
    });
  }
}
const Prisma = {
  PrismaClient,
  PrismaClientKnownRequestError: class extends Error { constructor(m, o = {}) { super(m); this.code = o.code; this.clientVersion = o.clientVersion; this.meta = o.meta; } },
  PrismaClientUnknownRequestError: class extends Error {},
  PrismaClientRustPanicError: class extends Error {},
  PrismaClientInitializationError: class extends Error { constructor(m) { super(m); this.errorCode = "P1001"; } },
  PrismaClientValidationError: class extends Error {},
  Decimal: class { constructor(v) { this.value = v; } toString() { return String(this.value); } toNumber() { return Number(this.value); } },
};
module.exports = Prisma;
module.exports.Prisma = Prisma;
module.exports.default = Prisma;
