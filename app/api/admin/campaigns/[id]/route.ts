import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { logAudit } from "@/lib/auth";
import { sendBatch } from "@/lib/campaign";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/* One campaign: read it, edit a draft, delete it, or push the next batch of sends.
   `action: "send"` is deliberately repeatable — the client keeps calling it until
   `done` comes back, which is how a large list goes out without a long request. */
export async function GET(req: Request, props: Ctx) {
  const params = await props.params;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const gid = parseIdParam(params.id);
  if (gid === null) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  const campaign = await db.campaign.findUnique({ where: { id: gid } });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ campaign });
}

export async function POST(req: Request, props: Ctx) {
  const params = await props.params;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  try {
    const b = await req.json().catch(() => ({}));
    if (String(b.action || "") === "send") {
      const before = await db.campaign.findUnique({ where: { id }, select: { status: true, sent: true } });
      if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (before.status === "SENT") return NextResponse.json({ ok: true, done: true, sent: 0, failed: 0, remaining: 0, alreadySent: true });
      const r = await sendBatch(id);
      if (r.error) return NextResponse.json({ error: r.error, ...r }, { status: 400 });
      const after = await db.campaign.findUnique({ where: { id }, select: { status: true, sent: true, failed: true, total: true } });
      if (r.done) await logAudit(g.user.email, "CAMPAIGN_SENT", `#${id} → ${after?.sent} delivered, ${after?.failed} failed`);
      return NextResponse.json({ ok: true, ...r, campaign: after });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  const before = await db.campaign.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (before.status !== "DRAFT") return NextResponse.json({ error: "A campaign that has already started sending cannot be edited." }, { status: 400 });
  const b = await req.json();
  if (!b.subject || !b.body) return NextResponse.json({ error: "Subject and body required" }, { status: 400 });
  const campaign = await db.campaign.update({
    where: { id },
    data: {
      subject: String(b.subject).slice(0, 180),
      body: String(b.body),
      ctaLabel: b.ctaLabel ? String(b.ctaLabel).slice(0, 40) : null,
      ctaUrl: b.ctaUrl ? String(b.ctaUrl).slice(0, 300) : null,
      total: before.sent === 0 ? before.total : before.total,
    },
  });
  await logAudit(g.user.email, "CAMPAIGN_EDIT", `${campaign.subject} (#${campaign.id})`);
  return NextResponse.json({ ok: true, campaign });
}

export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.campaign.delete({ where: { id } });
  await logAudit(g.user.email, "CAMPAIGN_DELETE", `${c.subject} (#${c.id})`);
  return NextResponse.json({ ok: true });
}
