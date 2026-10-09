import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { listPromotions, savePromotion, catalog, validateDraft, type PromotionDraft } from "@/lib/promotions/admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/promotions — every promotion (with a summary) + the pickers' catalog. */
export async function GET(req: Request) {
  const g = await requirePerm("promotions", req);
  if ("res" in g) return g.res;
  const [promotions, cat] = await Promise.all([listPromotions(), catalog()]);
  return NextResponse.json({ promotions, catalog: cat });
}

/** POST /api/admin/promotions — create (or update when the draft carries an id). */
export async function POST(req: Request) {
  const g = await requirePerm("promotions", req);
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => null)) as { draft?: PromotionDraft } | null;
  if (!body?.draft) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  /* Dry-run switch: the workbench validates without saving while typing. */
  const qs = new URL(req.url).searchParams;
  if (qs.get("dry") === "1") {
    const { errors, warnings } = validateDraft(body.draft);
    return NextResponse.json({ ok: errors.length === 0, errors, warnings });
  }

  const saved = await savePromotion(body.draft, g.user.id);
  if ("errors" in saved) return NextResponse.json({ error: saved.errors.join(" · "), errors: saved.errors }, { status: 400 });
  return NextResponse.json({ ok: true, id: saved.id });
}
