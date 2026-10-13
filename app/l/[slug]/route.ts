import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logApp } from "@/lib/logs";
import { safeExternalTarget } from "@/lib/url-guard";

export const dynamic = "force-dynamic";

/* Short campaign links (/l/<slug>) — Phase 3 click tracking.

   A campaign puts `{link}` in its body, which renders to this URL, so the click counter is a real
   count of how many people opened the offer. The redirect itself must never break: an unknown or
   expired slug falls back to the storefront instead of a 404 page. */
export async function GET(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const slug = String(params.slug || "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const link = slug ? await db.waLink.findUnique({ where: { slug } }).catch(() => null) : null;
  if (!link) {
    const base = process.env.NEXT_PUBLIC_SITE_URL || "/";
    return NextResponse.redirect(base.startsWith("http") ? base : new URL(base, req.url).toString(), 302);
  }

  await db.waLink
    .update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickAt: new Date() } })
    .catch(() => {});
  // one log line per click is noisy for a big campaign — only the first few get logged
  if (link.clicks < 20) {
    await logApp("INFO", "WHATSAPP", `campaign link ${slug} clicked (${link.clicks + 1})`, { broadcastId: link.broadcastId }).catch(() => {});
  }

  /* Redirect target. WaLink.target is written through Admin → Links, so it is not fully
     anonymous input — but "any http(s) URL goes straight into a 302" makes /l/<slug> an
     open redirect on the shop's own domain the moment one link row is wrong, and a
     campaign click is exactly the traffic a phisher wants to launder through a trusted
     host. Relative targets stay relative; absolute ones must be http(s) and either the
     shop's own origin or on the operator's allow-list. Anything else falls back to the
     storefront, which is the same behaviour an unknown slug already had. */
  const base = process.env.NEXT_PUBLIC_SITE_URL || "/";
  const baseOrigin = base.startsWith("http") ? new URL(base).origin : new URL(base, req.url).origin;
  const target = safeExternalTarget(link.target, { requestUrl: req.url, siteOrigin: baseOrigin });
  if (!target) return NextResponse.redirect(baseOrigin + "/", 302);
  return NextResponse.redirect(target, 302);
}
