import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { previewDraft, type PromotionDraft } from "@/lib/promotions/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/promotions/preview
 * Runs the real engine against an unsaved draft + a simulated cart.
 */
export async function POST(req: Request) {
  const g = await requirePerm("promotions", req);
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => null)) as
    | { draft?: PromotionDraft; items?: { productId: number; variantId?: number | null; qty: number }[] }
    | null;
  if (!body?.draft) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const result = await previewDraft({ draft: body.draft, items: body.items || [] });
  return NextResponse.json(result);
}
