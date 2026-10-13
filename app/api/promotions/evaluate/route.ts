import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { loadActivePromotion } from "@/lib/promotions/repository";
import { evaluateCart, giftLinesToDrop, toComboView, type StoreCartLine } from "@/lib/promotions/service";
import type { GiftSelectionMap } from "@/lib/promotions/types";

export const dynamic = "force-dynamic";

type Body = {
  lines?: StoreCartLine[];
  selections?: Record<string, { productId: number | string; variantId: number | string }>;
  grantedTierIndex?: number | null;
};

/* ---- request bounds -------------------------------------------------------
   This endpoint is public, unauthenticated and does real work per request:
   loadActivePromotion() is a join across the whole promotion aggregate, and when the
   live offer is CATEGORIES-scoped it also reads every ACTIVE product row. Nothing below
   was bounded, so a single multi-megabyte POST could make the engine allocate on the
   order of (lines × qty) array elements — lib/promotions/engine.ts expands every line
   into one entry per unit with Array.from({ length: quantity }) before sorting them.
   `qty` was already clamped to 99; the LINE COUNT was not, so 100k lines × 99 units is
   ~10M elements in an 896M container.

   A real cart holds a handful of items. These caps are far above any legitimate use and
   far below what hurts: the request is rejected rather than partially processed, so a
   client cannot smuggle an oversized body past the filter by padding it.

   Note: nothing in this repository calls this route any more — app/cart/layout.tsx,
   app/checkout/layout.tsx and app/products/[slug]/layout.tsx now hand the browser the
   promotion config as a server prop and the pure engine runs locally
   (lib/promotions/config-server.ts). It is kept, and hardened, rather than deleted in
   case something outside the repo still posts to it; deleting it is safe and is the
   better answer if that turns out not to be the case. */
const MAX_LINES = 60;
const MAX_SELECTIONS = 20;
const MAX_STR = 200;

const clampStr = (v: unknown, max = MAX_STR): string => {
  const s = String(v ?? "");
  return s.length > max ? s.slice(0, max) : s;
};

/** Loose validation — the engine re-checks everything that matters. Returns null when the
 *  request exceeds the bounds above, so the caller can 400 instead of processing it. */
function normalizeLines(raw: unknown): StoreCartLine[] | null {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_LINES) return null;
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      key: clampStr(l.key),
      productId: Number(l.productId) || 0,
      variantId: l.variantId != null ? Number(l.variantId) : undefined,
      slug: clampStr(l.slug),
      title: clampStr(l.title),
      image: typeof l.image === "string" ? clampStr(l.image, 500) : undefined,
      price: Number(l.price) || 0,
      qty: Math.max(1, Math.min(99, Number(l.qty) || 1)),
      size: typeof l.size === "string" ? clampStr(l.size, 40) : undefined,
      color: typeof l.color === "string" ? clampStr(l.color, 40) : undefined,
      stock: Number(l.stock) || 0,
      preorder: !!l.preorder,
      isGift: !!l.isGift,
      promotionId: typeof l.promotionId === "string" ? clampStr(l.promotionId, 64) : undefined,
      tierIndex: l.tierIndex != null ? Number(l.tierIndex) : undefined,
      slotKey: typeof l.slotKey === "string" ? clampStr(l.slotKey, 64) : undefined,
    }))
    .filter((l) => l.key && l.productId > 0);
}

/**
 * POST /api/promotions/evaluate
 *
 * Server-computed view of the live promotion for a given cart: the tier ladder,
 * which gift slots are unlocked, what is blocking, and which gift lines are no
 * longer legitimate. The cart UI renders exactly this — so the browser never
 * decides how many gifts a cart has earned.
 */
export async function POST(req: Request) {
  /* Volume cap before any JSON is parsed or any query runs: this is a public POST whose
     whole cost is attacker-chosen. 30/min is generous for a panel that re-evaluates on
     cart edits, and the hourly cap stops a slow drip that stays under the per-minute one. */
  const ip = getClientIp(req);
  if (!rateLimit(`promo-eval-ip:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests, try again later" }, { status: 429 });
  }
  if (!rateLimit(`promo-eval-ip-h:${ip}`, 200, 3_600_000)) {
    return NextResponse.json({ error: "Too many requests, try again later" }, { status: 429 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const promotion = await loadActivePromotion();
  if (!promotion) return NextResponse.json({ promotion: null, view: null });

  const lines = normalizeLines(body.lines);
  if (lines === null) {
    return NextResponse.json({ error: `Too many cart lines (max ${MAX_LINES})` }, { status: 400 });
  }

  // Category index only when the scope needs it (mirrors /active).
  let categories: Record<string, string> = {};
  const needsCategories = promotion.eligibilityScope === "CATEGORIES";
  if (needsCategories) {
    const rows = await db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, categoryId: true } });
    categories = Object.fromEntries(rows.filter((r) => r.categoryId != null).map((r) => [String(r.id), String(r.categoryId)]));
  }

  const selections: GiftSelectionMap = {};
  const selectionEntries = Object.entries(body.selections || {});
  if (selectionEntries.length > MAX_SELECTIONS) {
    return NextResponse.json({ error: `Too many gift selections (max ${MAX_SELECTIONS})` }, { status: 400 });
  }
  for (const [key, value] of selectionEntries) {
    if (!value) continue;
    selections[clampStr(key, 64)] = {
      productId: clampStr(value.productId, 32),
      variantId: clampStr(value.variantId, 32),
    };
  }

  /* A tier index is a small non-negative integer; an arbitrary number here would only ever
     fail a lookup later, so bound it where it enters. */
  const grantedTierIndex = Number.isInteger(body.grantedTierIndex)
    ? Math.min(Math.max(body.grantedTierIndex as number, -1), 999)
    : null;

  const evaluation = evaluateCart({
    promotion,
    lines,
    selections,
    categories,
    grantedTierIndex,
  });

  return NextResponse.json({
    promotion: { id: promotion.id, slug: promotion.slug },
    view: toComboView(promotion, evaluation),
    /** Cart lines the client must delete (gift no longer earned / no longer valid). */
    dropLines: giftLinesToDrop(evaluation, lines),
  });
}
