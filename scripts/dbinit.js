process.env.DATABASE_URL='file:'+require('path').resolve(__dirname,'..','prisma','dev.db');
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  // seed admin user + basic settings (never hardcode a static password)
  const adminPassRaw = process.env.SEED_ADMIN_PASS || crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(adminPassRaw, 10);
  const u = await db.user.upsert({ where: { email: 'Sinzo.bd@gmail.com' }, update: {}, create: { email: 'Sinzo.bd@gmail.com', password: hash, name: 'Super Admin', role: 'SUPER_ADMIN' } });
  console.log('admin user:', u.email);
  // add a few test products with variants and images
  const count = await db.product.count();
  if (count > 0) { console.log('products already exist:', count); process.exit(0); }
  const products = [
    { title: "Oversized Linen Shirt", slug: "oversized-linen-shirt", price: 3450, comparePrice: 4200, stock: 20, description: "Premium linen shirt", categoryId: null,
      images: ["/uploads/seed/p-shirt.jpg", "/uploads/seed/p-tee.jpg"],
      variants: [
        { size: "S", color: "White", stock: 7 }, { size: "S", color: "Sky", stock: 8 },
        { size: "M", color: "White", stock: 8 }, { size: "M", color: "Sky", stock: 8 },
        { size: "L", color: "White", stock: 8 }, { size: "L", color: "Sky", stock: 8 },
        { size: "XL", color: "White", stock: 8 }, { size: "XL", color: "Sky", stock: 8 },
      ] },
    { title: "Black Pleated Midi Dress", slug: "black-pleated-midi-dress", price: 3290, comparePrice: 3990, stock: 15, description: "Elegant midi dress",
      images: ["/uploads/seed/p-dress.jpg"],
      variants: [{ size: "S", color: "Black", stock: 5 }, { size: "M", color: "Black", stock: 5 }, { size: "L", color: "Black", stock: 5 }] },
    { title: "Classic Denim Jacket", slug: "classic-denim-jacket", price: 2990, stock: 10, description: "Classic denim",
      images: ["/uploads/seed/p-denim.jpg"],
      variants: [{ size: "M", color: "Blue", stock: 5 }, { size: "L", color: "Blue", stock: 5 }] },
  ];
  for (const p of products) {
    await db.product.create({ data: {
      title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice, stock: p.stock,
      description: p.description, status: "ACTIVE",
      images: { create: p.images.map((u, i) => ({ url: u, position: i, alt: p.title })) },
      variants: { create: p.variants.map(v => ({ size: v.size, color: v.color, stock: v.stock })) },
    }});
  }
  console.log("seeded", products.length, "products");
  process.exit(0);
})();
