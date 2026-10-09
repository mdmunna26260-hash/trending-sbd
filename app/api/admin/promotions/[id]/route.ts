import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { getPromotionDraft, savePromotion, deletePromotion, type PromotionDraft } from "@/lib/promotions/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — the full draft for the editor. */
export async function GET(req: Request, { params }: Ctx) {
  const g = await requirePerm("promotions", req);
  if ("res" in g) return g.res;
  const { id } = await params;
  const draft = await getPromotionDraft(id);
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const usages = await db.promotionUsage.findMany({
    where: { promotionId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { order: { select: { code: true, total: true, name: true, createdAt: true } } },
  });
  return NextResponse.json({
    draft,
    usages: usages.map((u) => ({
      id: u.id, orderCode: u.order.code, orderTotal: u.order.total, customer: u.order.name,
      tierIndex: u.tierIndex, giftCount: u.giftCount, giftValue: u.giftValueMinor / 100, at: u.createdAt,
    })),
  });
}

/** PUT — save the draft (creates when the draft has no id). */
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("promotions", req);
  if ("res" in g) return g.res;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { draft?: PromotionDraft } | null;
  if (!body?.draft) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const saved = await savePromotion({ ...body.draft, id }, g.user.id);
  if ("errors" in saved) return NextResponse.json({ error: saved.errors.join(" · "), errors: saved.errors }, { status: 400 });
  return NextResponse.json({ ok: true, id: saved.id });
}

/** DELETE — remove the promotion (its tiers, pools and usage rows cascade). */
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("promotions", req);
  if ("res" in g) return g.res;
  const { id } = await params;
  const used = await db.promotionUsage.count({ where: { promotionId: id } });
  if (used > 0) {
    /* Orders reference it — pause it instead of breaking history. */
    await db.promotion.update({ where: { id }, data: { status: "ENDED" } });
    return NextResponse.json({ ok: true, ended: true, note: `Ended instead of deleted — ${used} order(s) already used this offer.` });
  }
  await deletePromotion(id);
  return NextResponse.json({ ok: true });
}
