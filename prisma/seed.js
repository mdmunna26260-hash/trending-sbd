/* Seed script - realistic demo data (PDF section 61).
   Run: npm run db:seed */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

const DEFAULT_SETTINGS = {
  store: {
    name: "TRENDING'S",
    tagline: "Season 01 — Made for Dhaka",
    currency: "BDT",
    currencySymbol: "৳",
    email: "support@sinzo.com.bd",
    phone: "+880 1700-000000",
    whatsapp: "+8801700000000",
    address: "Gulshan Avenue, Dhaka 1212, Bangladesh",
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
    footerText: "Everyday essentials, cut and finished in Dhaka.",
  },
  theme: {
    bg: "#ffffff",
    text: "#14120f",
    accent: "#e4451f",
    headingFont: "'Archivo','Helvetica Neue',Arial,sans-serif",
    bodyFont: "'Archivo','Helvetica Neue',Arial,sans-serif",
    radius: 0,
    containerWidth: 1280,
    productImageRatio: "3:4",
  },
  shipping: {
    insideDhaka: 80,
    outsideDhaka: 140,
    freeShippingThreshold: 5000,
    estimateInside: "1-2 days",
    estimateOutside: "2-4 days",
  },
  homepage: {
    announcement: "CASH ON DELIVERY ACROSS BANGLADESH · DISPATCH IN 24–72H · 7-DAY RETURNS",
    heroTitle: "DRESS\nLIKE YOU\nMEAN IT.",
    heroSubtitle: "Premium essentials cut for Dhaka weather — breathable fabrics, honest pricing, and cash on delivery to every district.",
    heroCta: "Shop the drop",
    heroImage: "/uploads/seed/hero.jpg",
    promoTitle: "The Monsoon Edit",
    promoText: "Light layers, quick-dry fabrics. Up to 30% off selected pieces.",
    promoImage: "/uploads/seed/p-coat.jpg",
    featuredCollection: "new-arrivals",
  },
  integrations: {
    metaPixelId: "",
    metaAccessToken: "",
    metaTestEventCode: "",
    ga4Id: "",
    gtmId: "",
  },
  courier: {
    provider: "steadfast",
    apiUrl: "https://portal.packzy.com/api/v1",
    apiKey: "",
    secretKey: "",
    insideDhaka: 80,
    outsideDhaka: 140,
  },
  checkout: {
    codEnabled: true,
    onlinePaymentEnabled: false,
    minPhoneDigits: 11,
  },
  fraud: {
    enabled: true,
    maxOrdersPerHourPerPhone: 3,
    highRiskCancelCount: 3,
  },
  seo: {
    metaTitle: "TRENDING'S — Everyday essentials, made for Dhaka",
    metaDescription: "Breathable shirts, dresses and outerwear with cash on delivery across Bangladesh. Dispatched in 24–72 hours.",
  },
  marketing: { recoveryAutoEnabled: true, recoveryCoupon: "WELCOME10" },
  maintenance: { enabled: false, message: "We'll be back soon." },
};

async function main() {
  console.log("Seeding…");

  // ---- Settings ----
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: JSON.stringify(value) },
    });
  }

// ---- Users ----
// Credentials come from env (SEED_ADMIN_EMAIL/SEED_ADMIN_PASS, SEED_MANAGER_EMAIL/SEED_MANAGER_PASS).
// When no password is provided a random one is generated and printed ONCE to the
// console — never hardcode real passwords in source.
const crypto = require("crypto");
const adminEmail = process.env.SEED_ADMIN_EMAIL || "Sinzo.bd@gmail.com";
const adminPassRaw = process.env.SEED_ADMIN_PASS || crypto.randomBytes(9).toString("base64url");
if (!process.env.SEED_ADMIN_PASS) console.log(`[seed] admin login → ${adminEmail} / ${adminPassRaw} (set SEED_ADMIN_PASS to control it)`);
await prisma.user.upsert({
  where: { email: adminEmail },
  update: {},
  create: { email: adminEmail, password: await bcrypt.hash(adminPassRaw, 10), name: "Super Admin", role: "SUPER_ADMIN" },
});
const mgrEmail = process.env.SEED_MANAGER_EMAIL || "orders@sinzo.com.bd";
const mgrPassRaw = process.env.SEED_MANAGER_PASS || crypto.randomBytes(9).toString("base64url");
if (!process.env.SEED_MANAGER_PASS) console.log(`[seed] manager login → ${mgrEmail} / ${mgrPassRaw}`);
await prisma.user.upsert({
  where: { email: mgrEmail },
  update: {},
  create: { email: mgrEmail, password: await bcrypt.hash(mgrPassRaw, 10), name: "Order Manager", role: "ORDER_MANAGER" },
});

  // ---- Categories ----
  const cats = {};
  const catData = [
    ["Shirts", "shirts", "Crisp everyday shirting in premium fabrics."],
    ["Outerwear", "outerwear", "Coats and jackets built to last."],
    ["Dresses", "dresses", "Effortless silhouettes for every occasion."],
    ["Bottoms", "bottoms", "Tailored trousers and everyday denim."],
    ["Knitwear", "knitwear", "Soft layers for cooler evenings."],
    ["Accessories", "accessories", "Finishing touches, honestly made."],
    ["T-Shirts", "t-shirts", "Heavyweight cotton essentials."],
  ];
  for (const [name, slug, description] of catData) {
    cats[slug] = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, description },
    });
  }
  await prisma.category.update({ where: { slug: "shirts" }, data: { sizeChart:
    "<table><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th></tr><tr><td>S</td><td>38\"</td><td>27\"</td><td>17\"</td></tr><tr><td>M</td><td>40\"</td><td>28\"</td><td>17.5\"</td></tr><tr><td>L</td><td>42\"</td><td>29\"</td><td>18\"</td></tr><tr><td>XL</td><td>44\"</td><td>30\"</td><td>18.5\"</td></tr></table>" } });
  await prisma.category.update({ where: { slug: "dresses" }, data: { sizeChart:
    "<table><tr><th>Size</th><th>Bust</th><th>Waist</th><th>Length</th></tr><tr><td>S</td><td>34\"</td><td>26\"</td><td>45\"</td></tr><tr><td>M</td><td>36\"</td><td>28\"</td><td>46\"</td></tr><tr><td>L</td><td>38\"</td><td>30\"</td><td>47\"</td></tr></table>" } });

  // ---- Collections ----
  const cols = {};
  for (const [title, slug, subtitle] of [
    ["New Arrivals", "new-arrivals", "Fresh off the atelier floor"],
    ["Best Sellers", "best-sellers", "The pieces you keep coming back to"],
    ["Winter Sale", "sale", "Up to 30% off selected styles"],
  ]) {
    cols[slug] = await prisma.collection.upsert({
      where: { slug },
      update: {},
      create: { title, slug, subtitle },
    });
  }

  // ---- Products (10) ----
  const APPAREL = ["S", "M", "L", "XL"];
  const products = [
    { title: "Oversized Linen Shirt", slug: "oversized-linen-shirt", price: 1890, comparePrice: 2400, cat: "shirts", img: "/uploads/seed/p-shirt.jpg",
      short: "Breathable European linen with a relaxed drape and mother-of-pearl buttons.",
      desc: "Cut from breathable European linen, our oversized shirt drapes beautifully and softens with every wash. Mother-of-pearl buttons, dropped shoulders, and a curved hem make it as easy over a tee as it is tucked into tailored trousers.",
      tags: "linen,oversized,summer", featured: true, sizes: APPAREL, colors: ["White", "Sky"], stock: 24 },
    { title: "Camel Wool Overcoat", slug: "camel-wool-overcoat", price: 6450, comparePrice: 8900, cat: "outerwear", img: "/uploads/seed/p-coat.jpg",
      short: "A tailored double-faced wool coat in a warm camel tone.",
      desc: "Our signature overcoat is tailored from double-faced wool with a clean notch lapel and hidden closure. Fully lined, mid-calf length, with deep welt pockets. The kind of coat that quietly elevates everything under it.",
      tags: "wool,winter,coat", featured: true, sizes: APPAREL, colors: ["Camel", "Charcoal"], stock: 12 },
    { title: "Black Pleated Midi Dress", slug: "black-pleated-midi-dress", price: 3290, comparePrice: null, cat: "dresses", img: "/uploads/seed/p-dress.jpg",
      short: "Fluid pleats, matte finish, endlessly versatile.",
      desc: "Heat-set pleats give this midi dress its fluid movement, while a matte finish keeps it modern. Elasticated waist, midi length, and a silhouette that travels from desk to dinner without a thought.",
      tags: "dress,pleated,evening", featured: true, sizes: ["S", "M", "L"], colors: ["Black"], stock: 18 },
    { title: "Wide-Leg Tailored Trousers", slug: "wide-leg-tailored-trousers", price: 2450, comparePrice: 2990, cat: "bottoms", img: "/uploads/seed/p-trousers.jpg",
      short: "High-waisted, pleated, and pressed to perfection.",
      desc: "High-waisted with a single front pleat, these wide-leg trousers are pressed for a sharp line and cut with a generous leg that falls just right. Hidden hook closure, side pockets, back welt pocket.",
      tags: "trousers,tailored,formal", featured: false, sizes: APPAREL, colors: ["Beige", "Black"], stock: 20 },
    { title: "Cream Chunky Knit", slug: "cream-chunky-knit", price: 2790, comparePrice: 3400, cat: "knitwear", img: "/uploads/seed/p-knit.jpg",
      short: "Chunky ribbed knit with a soft, lofty hand-feel.",
      desc: "Spun into a chunky rib with a soft, lofty hand-feel, this oversized knit is winter warmth without the weight. Ribbed collar, cuffs, and hem hold their shape wash after wash.",
      tags: "knit,winter,cozy", featured: false, sizes: ["M", "L", "XL"], colors: ["Cream", "Oat"], stock: 15 },
    { title: "Tan Leather Tote", slug: "tan-leather-tote", price: 3850, comparePrice: 4500, cat: "accessories", img: "/uploads/seed/p-bag.jpg",
      short: "Full-grain leather, structured silhouette, fits a 14\" laptop.",
      desc: "Cut from full-grain vegetable-tanned leather that patinas beautifully, this structured tote swallows a 14-inch laptop, a notebook, and the rest of your day. Magnetic closure, suede-lined base, interior zip pocket.",
      tags: "leather,bag,everyday", featured: true, sizes: null, colors: ["Tan", "Espresso"], stock: 10 },
    { title: "Relaxed Heavyweight Tee", slug: "relaxed-heavyweight-tee", price: 890, comparePrice: 1200, cat: "t-shirts", img: "/uploads/seed/p-tee.jpg",
      short: "240 GSM combed cotton. The perfect white tee exists.",
      desc: "At 240 GSM of combed cotton, this is no ordinary tee. Boxy-but-not-baggy cut, ribbed neckline that won't sag, and a hand-feel that only improves with age. Sold in packs of one, worn in rotation forever.",
      tags: "tee,cotton,basic", featured: false, sizes: APPAREL, colors: ["White", "Black", "Sand"], stock: 60 },
    { title: "Classic Denim Jacket", slug: "classic-denim-jacket", price: 2990, comparePrice: null, cat: "outerwear", img: "/uploads/seed/p-denim.jpg",
      short: "Rigid 12oz indigo denim that breaks in beautifully.",
      desc: "A faithful take on the trucker jacket in rigid 12oz indigo denim. Copper shanks, chest flap pockets, and a fit that sits easy over a hoodie or a tee. Breaks in beautifully — your job is just to wear it.",
      tags: "denim,jacket,classic", featured: false, sizes: APPAREL, colors: ["Indigo"], stock: 14 },
    { title: "Poplin Column Dress", slug: "poplin-column-dress", price: 3050, comparePrice: null, cat: "dresses", img: "/uploads/seed/p-dress.jpg",
      short: "Crisp cotton poplin with a sculptural column silhouette.",
      desc: "Crisp cotton poplin falls in a clean column shape, with a boat neckline and subtle back slit. Unlined but opaque. Press the creases in — or don't. It reads intentional either way.",
      tags: "dress,poplin,minimal", featured: false, sizes: ["S", "M", "L"], colors: ["Off-white"], stock: 9 },
    { title: "Merino Crew Sweater", slug: "merino-crew-sweater", price: 3150, comparePrice: 3800, cat: "knitwear", img: "/uploads/seed/p-knit.jpg",
      short: "Fine-gauge merino, cut clean. Layers under everything.",
      desc: "Fine-gauge merino wool in a clean crew cut — warm without bulk, and slim enough to layer under the Camel Overcoat. Ribbed detailing at collar and cuffs, fully fashioned seams.",
      tags: "merino,knit,layer", featured: false, sizes: APPAREL, colors: ["Grey Melange", "Navy"], stock: 16 },
  ];

  const made = [];
  for (const p of products) {
    const prod = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        title: p.title, slug: p.slug, shortDesc: p.short, description: p.desc,
        price: p.price, comparePrice: p.comparePrice, cost: Math.round(p.price * 0.55),
        sku: "SNZ-" + p.slug.toUpperCase().slice(0, 3) + "-" + Math.floor(1000 + Math.random() * 9000),
        stock: p.stock, lowStock: 5, featured: p.featured, tags: p.tags, position: products.indexOf(p) + 1,
        categoryId: cats[p.cat].id,
        images: { create: [{ url: p.img, alt: p.title, position: 0 }] },
      },
    });
    if (p.sizes) {
      const existing = await prisma.productVariant.count({ where: { productId: prod.id } });
      if (!existing) {
        for (const size of p.sizes) for (const color of p.colors) {
          await prisma.productVariant.create({ data: {
            productId: prod.id, size, color,
            sku: `${prod.sku}-${size}-${color.slice(0,3).toUpperCase()}`,
            stock: Math.max(2, Math.round(p.stock / (p.sizes.length * p.colors.length))),
          }});
        }
      }
    }
    made.push({ prod, slug: p.slug });
  }

  // collections
  const link = async (slug, items) => {
    for (const m of items) {
      await prisma.collectionProduct.upsert({
        where: { collectionId_productId: { collectionId: cols[slug].id, productId: m.prod.id } },
        update: {}, create: { collectionId: cols[slug].id, productId: m.prod.id },
      }).catch(() => {});
    }
  };
  await link("new-arrivals", made.slice(0, 6));
  await link("best-sellers", [made[1], made[0], made[2], made[5], made[6], made[4]]);
  await link("sale", made.filter((_, i) => [0, 1, 3, 4, 5, 9].includes(i)));

  // ---- Reviews (approved) ----
  const r = made[1].prod;
  const reviewCount = await prisma.review.count({ where: { productId: r.id } });
  if (!reviewCount) {
    await prisma.review.createMany({ data: [
      { productId: r.id, name: "Farhan A.", rating: 5, text: "Quality is unbelievable for the price. Fit is exactly as the size chart says.", status: "APPROVED", verified: true },
      { productId: r.id, name: "Nusrat J.", rating: 5, text: "Warm, elegant, and the stitching is flawless. Delivered in 1 day inside Dhaka.", status: "APPROVED", verified: true },
      { productId: made[0].prod.id, name: "Tanvir H.", rating: 4, text: "Beautiful linen. Slightly long on me but tailoring fixed it.", status: "APPROVED" },
    ]});
  }

  // ---- Coupon ----
  await prisma.coupon.upsert({
    where: { code: "WELCOME10" },
    update: {},
    create: { code: "WELCOME10", type: "percent", value: 10, minOrder: 1500, maxDiscount: 500, usageLimit: 500, perCustomer: 1, active: true },
  });
  await prisma.coupon.upsert({
    where: { code: "FREESHIP" },
    update: {},
    create: { code: "FREESHIP", type: "freeship", value: 0, minOrder: 2000, active: true },
  });

  // ---- Sample customer + order ----
  const sc = await prisma.customer.upsert({
    where: { phone: "01712345678" },
    update: {},
    create: { phone: "01712345678", name: "Sample Customer", address: "House 12, Road 5, Dhanmondi", area: "INSIDE_DHAKA" },
  });
  const orderCount = await prisma.order.count();
  if (!orderCount) {
    const first = made[6].prod;
    const o = await prisma.order.create({ data: {
      code: "ORD-1001", name: "Sample Customer", phone: "01712345678",
      address: "House 12, Road 5, Dhanmondi", area: "INSIDE_DHAKA",
      subtotal: first.price, deliveryFee: 80, total: first.price + 80,
      status: "DELIVERED", paymentStatus: "PAID", paymentMethod: "COD",
      source: "Direct", customerId: sc.id,
      items: { create: [{ productId: first.id, title: first.title, price: first.price, qty: 1, image: p_tee_img() }] },
    }});
    await prisma.auditLog.create({ data: { userEmail: "system@seed", action: "SEED", detail: "Sample order " + o.code } });
  }
  function p_tee_img() { return "/uploads/seed/p-tee.jpg"; }

  console.log("Seed complete ✔  Admin: Sinzo.bd@gmail.com");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
