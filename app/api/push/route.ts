import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureExtraTables } from "@/lib/db-ensure";
import { getVapid } from "@/lib/webpush";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { normalizeBDPhone } from "@/lib/phone";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";

/* GET → VAPID public key (+ whether this exact browser subscription is saved) */
export async function GET(req: Request) {
  try {
    const { publicKey } = await getVapid();
    const endpoint = new URL(req.url).searchParams.get("endpoint");
    let subscribed = false;
    if (endpoint) {
      await ensureExtraTables().catch(() => {});
      subscribed = !!(await db.pushSubscription.findUnique({ where: { endpoint } }).catch(() => null));
    }
    return NextResponse.json({ publicKey, subscribed });
  } catch {
    return NextResponse.json({ error: "Push not available" }, { status: 500 });
  }
}

/* POST → save/update this browser's subscription (phone links it to order updates) */
export async function POST(req: Request) {
  try {
    /* One browser only needs to save its subscription a handful of times, so 20/hour per IP sits
       far above what a real client does (they retry on failure) and far below what an
       unauthenticated writer should be allowed — each request is a Prisma upsert plus
       ensureExtraTables(). GET is deliberately left unlimited: the storefront widget calls it on
       every page load just to read the VAPID public key, and throttling that would silently break
       push opt-in for real customers. */
    if (!rateLimit(`push-sub:${getClientIp(req)}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const b = await req.json();
    const sub = b.subscription || {};
    const keys = sub.keys || {};
    if (!sub.endpoint || !keys.p256dh || !keys.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }
    await ensureExtraTables();
    const session = await getCustomerSessionFromRequest(req);
    let phone: string | null = null;
    if (b.phone) {
      const p = normalizeBDPhone(String(b.phone));
      phone = /^01[3-9]\d{8}$/.test(p) ? p : null;
    }
    await db.pushSubscription.upsert({
      where: { endpoint: String(sub.endpoint).slice(0, 900) },
      update: { p256dh: String(keys.p256dh), auth: String(keys.auth), phone, updatedAt: new Date() },
      create: { endpoint: String(sub.endpoint).slice(0, 900), p256dh: String(keys.p256dh), auth: String(keys.auth), phone },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save subscription" }, { status: 500 });
  }
}

/* DELETE → unsubscribe this browser */
export async function DELETE(req: Request) {
  try {
    /* Added after the POST limiter: this is the third unauthenticated write on this route and was
       left uncapped. Each call runs ensureExtraTables() — real DDL — plus a deleteMany, so junk
       endpoints spammed at it amplify into unbounded database work for nothing. 20/hour per IP
       matches POST and is far above a person toggling notifications off.

       Note this handler also has no ownership check: it deletes whatever endpoint the body names.
       That is not exploitable for deleting OTHERS' subscriptions, because a push endpoint is a long
       opaque unguessable token that this API never returns (GET answers only {publicKey, subscribed}),
       so possession of it is effectively the capability. It is left as-is deliberately — tying
       subscriptions to customer sessions is a data-model change, not a hardening one — but it is
       recorded in the review as a known gap. */
    if (!rateLimit(`push-del:${getClientIp(req)}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const b = await req.json().catch(() => ({}));
    if (b.endpoint) {
      await ensureExtraTables().catch(() => {});
      await db.pushSubscription.deleteMany({ where: { endpoint: String(b.endpoint) } });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
