import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadActivePromotion } from "@/lib/promotions/repository";
import { evaluateCart, giftLinesToDrop, toComboView, type StoreCartLine } from "@/lib/promotions/service";
import type { GiftSelectionMap } from "@/lib/promotions/types";

export const dynamic = "force-dynamic";

type Body = {
  lines?: StoreCartLine[];
  selections?: Record<string, { productId: number | string; variantId: number | string }>;
  grantedTierIndex?: number | null;
};

/** Loose validation — the engine re-checks everything that matters. */
function normalizeLines(raw: unknown): StoreCartLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      key: String(l.key ?? ""),
      productId: Number(l.productId) || 0,
      variantId: l.variantId != null ? Number(l.variantId) : undefined,
      slug: String(l.slug ?? ""),
      title: String(l.title ?? ""),
      image: typeof l.image === "string" ? l.image : undefined,
      price: Number(l.price) || 0,
      qty: Math.max(1, Math.min(99, Number(l.qty) || 1)),
      size: typeof l.size === "string" ? l.size : undefined,
      color: typeof l.color === "string" ? l.color : undefined,
      stock: Number(l.stock) || 0,
      preorder: !!l.preorder,
      isGift: !!l.isGift,
      promotionId: typeof l.promotionId === "string" ? l.promotionId : undefined,
      tierIndex: l.tierIndex != null ? Number(l.tierIndex) : undefined,
      slotKey: typeof l.slotKey === "string" ? l.slotKey : undefined,
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
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const promotion = await loadActivePromotion();
  if (!promotion) return NextResponse.json({ promotion: null, view: null });

  const lines = normalizeLines(body.lines);

  // Category index only when the scope needs it (mirrors /active).
  let categories: Record<string, string> = {};
  const needsCategories = promotion.eligibilityScope === "CATEGORIES";
  if (needsCategories) {
    const rows = await db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, categoryId: true } });
    categories = Object.fromEntries(rows.filter((r) => r.categoryId != null).map((r) => [String(r.id), String(r.categoryId)]));
  }

  const selections: GiftSelectionMap = {};
  for (const [key, value] of Object.entries(body.selections || {})) {
    if (!value) continue;
    selections[key] = { productId: String(value.productId), variantId: String(value.variantId) };
  }

  const evaluation = evaluateCart({
    promotion,
    lines,
    selections,
    categories,
    grantedTierIndex: body.grantedTierIndex ?? null,
  });

  return NextResponse.json({
    promotion: { id: promotion.id, slug: promotion.slug },
    view: toComboView(promotion, evaluation),
    /** Cart lines the client must delete (gift no longer earned / no longer valid). */
    dropLines: giftLinesToDrop(evaluation, lines),
  });
}
