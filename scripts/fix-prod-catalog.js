#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * scripts/fix-prod-catalog.js — one-time catalogue hygiene for PRODUCTION.
 *
 * Repairs exactly what the 2026-09-15 audit of sinzooffcial.com found:
 *   1. trailing / doubled whitespace in text  ("LATHER JACKET " → "LATHER JACKET")
 *      …which leaked into <title>, og:title and JSON-LD (search snippets too)
 *   2. misspelled category slug + label        (stright-fit → straight-fit)
 *      — safe: lib/search.ts aliases both spellings, so no link ever 404s
 *   3. misspelled product names                (LATHER → LEATHER, FALME → FLAME)
 *      — titles always; slugs only with --slugs (ads/WhatsApp links point at the
 *        current slug, so moving it is opt-in)
 *   4. products missing from their own category → the "LEATHER JACKET" menu link
 *      opened an empty page while the jacket sat in a different category
 *   5. /collections/sale was empty although the page promised
 *      "Up to 30% off selected styles" → fill it from comparePrice
 *   6. store.instagram containing a facebook.com URL (footer linked Instagram to FB)
 *   7. an empty homepage meta title (the site shipped as bare "TRENDING'S")
 *
 * DRY RUN BY DEFAULT — nothing is written unless you pass --apply.
 *   node scripts/fix-prod-catalog.js            # read-only report
 *   node scripts/fix-prod-catalog.js --apply    # write
 *   node scripts/fix-prod-catalog.js --apply --slugs
 * Idempotent: a clean database reports 0 fixes.
 * ------------------------------------------------------------------------- */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const ALSO_SLUGS = process.argv.includes("--slugs");

const TYPO = { LATHER: "LEATHER", FALME: "FLAME" };
const CAT_FIX = {
  "stright-fit": { slug: "straight-fit", name: "Straight Fit" },
  "lather-jacket": { slug: "leather-jacket", name: "Leather Jacket" },
};

/* same rules as lib/slug.ts (that file is TS, so it can't be required here) */
const slugify = (x) => String(x).toLowerCase().trim().replace(/[^a-z0-9\u0980-\u09FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item-" + Date.now().toString(36);
/** collapse runs of spaces, trim; keeps real paragraph breaks */
const squash = (v) => String(v == null ? "" : v).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const fixTitle = (t) => squash(t).replace(/\bLATHER\b/gi, TYPO.LATHER).replace(/\bFALME\b/gi, TYPO.FLAME);

/* Plan first, write second: every fix is printed before ANY of them is applied,
   and writes are awaited one at a time (a fire-and-forget promise here gets cut
   off by $disconnect() and silently skips updates). */
const queue = [];
let failed = 0;
function log(kind, what, exec) {
  console.log(`  ${APPLY ? "✏︎ " : "·  "}[${kind}] ${what}`);
  if (exec) queue.push({ what, exec });
}
async function runQueue() {
  for (const job of queue) {
    try { await job.exec(); }
    catch (e) { failed++; console.log(`     ! failed: ${job.what} — ${String((e && e.message) || e).split("\n")[0].slice(0, 140)}`); }
  }
}

(async () => {
  console.log(APPLY ? `APPLYING ${ALSO_SLUGS ? "(+ slug moves) " : ""}to the database…\n` : "DRY RUN — add --apply to write\n");

  const products = await prisma.product.findMany({
    select: { id: true, title: true, slug: true, shortDesc: true, description: true, tags: true, categoryId: true, comparePrice: true, price: true, status: true },
  });
  const cats = await prisma.category.findMany({ select: { id: true, name: true, slug: true } });
  const bestTitle = new Map(products.map((p) => [p.id, fixTitle(p.title)]));

  /* 1 — whitespace in customer-visible text */
  for (const p of products) {
    const data = {};
    if (squash(p.title) !== p.title) data.title = squash(p.title);
    if (p.shortDesc != null && squash(p.shortDesc) !== p.shortDesc) data.shortDesc = squash(p.shortDesc);
    if (p.description != null && squash(p.description) !== p.description) data.description = squash(p.description);
    if (p.tags != null && squash(p.tags) !== p.tags) data.tags = squash(p.tags);
    const keys = Object.keys(data);
    if (keys.length) {
      log("text", `#${p.id} ${JSON.stringify(p.title)} → cleaned ${keys.join(", ")}`, () => prisma.product.update({ where: { id: p.id }, data }));
    }
  }

  /* 2 — category slug + label spelling */
  for (const c of cats) {
    const fix = CAT_FIX[c.slug];
    if (!fix) continue;
    const data = {};
    if (squash(c.name) !== fix.name) data.name = fix.name;
    if (c.slug !== fix.slug) data.slug = fix.slug;
    if (Object.keys(data).length) {
      log("category", `"${c.name}" (${c.slug}) → "${fix.name}" (${fix.slug}) — old links still resolve via lib/search.ts aliases`,
        () => prisma.category.update({ where: { id: c.id }, data }));
    }
  }

  /* 3 — product name typos (title always; slug only with --slugs) */
  for (const p of products) {
    const fixed = bestTitle.get(p.id);
    const cur = squash(p.title);
    if (!fixed || fixed === cur) continue;
    const newSlug = slugify(fixed);
    const moveSlug = ALSO_SLUGS && newSlug !== p.slug;
    log("title", `#${p.id} "${cur}" → "${fixed}"${moveSlug ? ` (slug ${p.slug} → ${newSlug})` : " [slug kept]"}`,
      () => prisma.product.update({ where: { id: p.id }, data: { title: fixed, ...(moveSlug ? { slug: newSlug } : {}) } }));
  }

  /* 4 — a product that belongs to a category which currently has no products.
        EVERY word of the category name must appear in the title, so
        "Leather Jacket" matches "LEATHER JACKET" but never "Tan Leather Tote". */
  for (const c of cats) {
    const words = squash(c.name).replace(/[^a-z ]/gi, "").trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!words.length) continue;
    const inCat = await prisma.product.count({ where: { categoryId: c.id, status: "ACTIVE" } });
    if (inCat > 0) continue;
    const orphans = products.filter((p) => {
      if (p.status !== "ACTIVE" || p.categoryId === c.id) return false;
      const t = bestTitle.get(p.id) || "";
      return words.every((w) => new RegExp(`\\b${w}\\w*`, "i").test(t));
    });
    for (const o of orphans) {
      log("assign", `#${o.id} "${squash(o.title)}" → category "${squash(c.name)}" (that menu link currently shows 0 products)`,
        () => prisma.product.update({ where: { id: o.id }, data: { categoryId: c.id } }));
    }
  }

  /* 5 — /collections/sale: fill from real discounts when the admin left it empty */
  const sale = await prisma.collection.findUnique({ where: { slug: "sale" }, include: { products: { select: { productId: true } } } });
  if (sale) {
    if (sale.products.length === 0) {
      const linked = new Set(sale.products.map((x) => x.productId));
      const discounted = products.filter((p) => p.status === "ACTIVE" && p.comparePrice && p.comparePrice > p.price && !linked.has(p.id));
      for (const d of discounted) {
        const pct = Math.round((1 - d.price / d.comparePrice) * 100);
        log("sale", `add #${d.id} "${squash(d.title)}" (৳${d.price}, was ৳${d.comparePrice} = -${pct}%) to the SALE collection`,
          () => prisma.collectionProduct.create({ data: { collectionId: sale.id, productId: d.id } }));
      }
      if (!discounted.length) console.log("  ·  [sale] empty, and no product has a compare-price — add discounts in admin, or delete the collection so it stops appearing in the sitemap");
    }
  } else {
    console.log("  ·  [sale] no collection with slug 'sale' (check the nav/sitemap still don't link to it)");
  }

  /* 6 — store settings that contradict themselves */
  const storeRow = await prisma.setting.findUnique({ where: { key: "store" } });
  if (storeRow) {
    let st = null; try { st = JSON.parse(storeRow.value); } catch {}
    if (st && st.instagram && /facebook\.com/i.test(String(st.instagram))) {
      const cleared = { ...st, instagram: "" };
      log("settings", "store.instagram points at facebook.com → cleared (add the real Instagram URL in Admin → Settings)",
        () => prisma.setting.update({ where: { key: "store" }, data: { value: JSON.stringify(cleared) } }));
    }
  }

  /* 7 — homepage meta title must not be blank */
  const seoRow = await prisma.setting.findUnique({ where: { key: "seo" } });
  let seo = {}; try { seo = seoRow ? JSON.parse(seoRow.value) : {}; } catch {}
  if (!squash(seo.metaTitle || "")) {
    const metaTitle = "TRENDING'S — Shirts, Polos, Tees & Jackets · Cash on Delivery in Bangladesh";
    log("seo", 'homepage <title> is a bare "TRENDING'S" (no keywords, no USP) → set a real meta title',
      () => prisma.setting.upsert({
        where: { key: "seo" },
        update: { value: JSON.stringify({ ...seo, metaTitle }) },
        create: { key: "seo", value: JSON.stringify({ metaTitle }) },
      }));
  }

  if (APPLY) await runQueue();
  const n = queue.length;
  console.log(`\n${APPLY
    ? `Applied ${n - failed} of ${n} queued fixes${failed ? `, ${failed} failed` : ""}. Re-run without --apply to confirm it is clean.`
    : (n ? `Found ${n} fixes to apply — read the list, then run:  node scripts/fix-prod-catalog.js --apply` : "Nothing to fix — catalogue is clean ✔")}`);
})()
  .catch((e) => { console.error("FAILED:", (e && e.message) || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
