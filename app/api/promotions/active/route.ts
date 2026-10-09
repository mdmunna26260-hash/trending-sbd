import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadActivePromotion } from "@/lib/promotions/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/promotions/active
 *
 * Public promotion config for the storefront: the live gift-tier promotion plus
 * a productId → categoryId index (only needed when eligibility is
 * CATEGORIES-scoped, which is exactly when the cart can't work it out alone).
 *
 * Cached for a minute at the edge: a promotion changes through the admin, not
 * per visitor.
 */
export async function GET() {
  try {
    const promotion = await loadActivePromotion();
    if (!promotion) {
      return NextResponse.json(
        { promotion: null, categories: {} },
        { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } },
      );
    }

    let categories: Record<string, string> = {};
    if (promotion.eligibilityScope === "CATEGORIES") {
      const rows = await db.product.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, categoryId: true },
      });
      categories = Object.fromEntries(
        rows.filter((r) => r.categoryId != null).map((r) => [String(r.id), String(r.categoryId)]),
      );
    }

    return NextResponse.json(
      { promotion, categories },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("[promotions] active failed:", error);
    return NextResponse.json({ promotion: null, categories: {}, error: "unavailable" }, { status: 200 });
  }
}
