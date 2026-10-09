/**
 * PROMOTIONS — server → client config bridge
 *
 * The storefront used to POST its cart to /api/promotions/evaluate on every
 * change. That made the whole gift panel depend on a network round trip: one
 * hiccup and the shopper saw nothing at all.
 *
 * Instead the server now hands the browser the ACTIVE promotion config (plain
 * JSON) and the browser runs the very same pure engine locally. No fetch, no
 * failure mode, instant panel. The checkout still re-validates server-side, so
 * nothing about the trust model changes.
 */
import { db } from "@/lib/db";
import { loadActivePromotion } from "./repository";
import { toEnginePromotion } from "./repository";

export type ClientPromotionConfig = {
  /** EnginePromotion with ISO date strings (or null when no offer is running). */
  promotion: any | null;
  /** productId → categoryId; only filled when the scope needs categories. */
  categories: Record<string, string>;
};

/** Serialises dates so the payload survives the server→client boundary. */
function serialize(promotion: unknown) {
  return JSON.parse(JSON.stringify(promotion));
}

export async function loadClientPromotionConfig(): Promise<ClientPromotionConfig> {
  try {
    const promotion = await loadActivePromotion();
    if (!promotion) return { promotion: null, categories: {} };

    let categories: Record<string, string> = {};
    if (promotion.eligibilityScope === "CATEGORIES") {
      const rows = await db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, categoryId: true } });
      categories = Object.fromEntries(rows.filter((r) => r.categoryId != null).map((r) => [String(r.id), String(r.categoryId)]));
    }
    return { promotion: serialize(promotion), categories };
  } catch {
    /* DB hiccup: the shop still renders, the gift panel simply stays off. */
    return { promotion: null, categories: {} };
  }
}

/** Exported for the admin preview bridge (same serialisation rules). */
export { serialize as serializePromotion, toEnginePromotion };
