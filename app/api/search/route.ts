import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productSearchWhere, terms } from "@/lib/search";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";
// thumbs render at ~40px — the 300px variant is plenty (saves ~90% of image bytes)
const small = (url: string | null) => {
  if (!url) return null;
  if (url.includes("/uploads/seed/")) return url.replace(/\.jpg$/, "-300.webp");
  const m = url.match(/^\/api\/media\/([a-z0-9]+)$/i);
  return m ? `/api/media/${m[1]}/w300` : url;
};
const pick = (p: any) => ({ id: p.id, title: p.title, slug: p.slug, image: small(p.images?.[0]?.url || null), price: p.price });

const SELECT = { id: true, title: true, slug: true, price: true, images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 } } as const;

export async function GET(req: Request) {
  /* Every search runs at least one LIKE query and, on a miss, a second "popular" query.
     The result set is capped at 12 rows so the cost per request is bounded, but the
     request rate was not: a loop here is a straightforward way to keep the single VPS
     Postgres busy.

     Raised from 60/min after measuring it. Under load the endpoint answers in a median
     of 3.4ms (p90 12.2ms), so 60/min was two orders of magnitude tighter than its actual
     cost justifies, and it failed in a way nobody would notice: chrome.tsx debounces with
     a trailing-edge 220ms timer, so one shopper only ever sends a handful of calls — but
     Bangladeshi mobile carriers put thousands of subscribers behind one CGNAT address, and
     they all share this single per-IP bucket. Past the limit the client's `catch {}` and
     `j.products || []` turn a 429 into an empty suggestion list, so search-as-you-type
     quietly stops working for a whole carrier's users with no error on screen and nothing
     in the server log to explain it. 240/min still cuts a single source to 4 req/s against
     the ~290 req/s it could otherwise sustain, while leaving roughly thirty shoppers per
     shared IP room to type. */
  if (!rateLimit("search:" + getClientIp(req), 240, 60 * 1000)) {
    return NextResponse.json({ products: [], popular: false, noResults: true, total: 0, error: "Too many searches, slow down a little." }, { status: 429 });
  }
  // clamp the query: a 20 KB ?q= used to be passed straight into LIKE
  const q = (new URL(req.url).searchParams.get("q") || "").slice(0, 80).trim();

  // not enough to search on → show the popular rail instead of an empty box
  if (terms(q).length === 0) {
    const popular = await db.product.findMany({ where: { status: "ACTIVE" }, orderBy: { views: "desc" }, take: 8, select: SELECT });
    return NextResponse.json({ products: popular.map(pick), popular: true });
  }

  const base = productSearchWhere(q);
  const found = await db.product.findMany({
    where: { status: "ACTIVE", ...(base ? { AND: [base] } : {}) },
    select: SELECT,
    take: 12,
    orderBy: { views: "desc" },
  });

  // search must never dead-end: fall back to the popular rail with a flag so the
  // UI can render "nothing matched — popular picks" instead of a blank sheet
  if (!found.length) {
    const popular = await db.product.findMany({ where: { status: "ACTIVE" }, orderBy: { views: "desc" }, take: 6, select: SELECT });
    return NextResponse.json({ products: popular.map(pick), popular: false, noResults: true, total: 0 });
  }
  return NextResponse.json({ products: found.map(pick), popular: false, noResults: false, total: found.length });
}
