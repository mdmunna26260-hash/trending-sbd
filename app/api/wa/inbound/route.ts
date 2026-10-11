import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { waSend, bridgeAuthorized } from "@/lib/wa";
import { getSettings, envFallback } from "@/lib/settings";
import { logApp } from "@/lib/logs";
export const dynamic = "force-dynamic";

/* Inbound WhatsApp webhook — called by the local bridge (scripts/whatsapp-bridge.js) when a
   customer messages the shop number. The bridge key is checked against the same value the
   bridge sends, so an open endpoint cannot be used to stuff the inbox. */
/** 8801676450711 → 01676450711 (how phone numbers are stored on orders). */
function toLocal(waId: string): string {
  const d = String(waId || "").replace(/\D/g, "");
  if (d.startsWith("880")) return "0" + d.slice(3);
  return d;
}

export async function POST(req: Request) {
  if (!(await bridgeAuthorized(req))) {
    return NextResponse.json({ error: "bad bridge key" }, { status: 401 });
  }

  const b = await req.json().catch(() => ({}));
  const waId = String(b.waId || "").replace(/\D/g, "");
  const body = String(b.body || "").trim();
  if (!waId || !body) return NextResponse.json({ error: "waId and body required" }, { status: 400 });

  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  // link to an order when this number has one
  const local = toLocal(waId);
  const order = await db.order.findFirst({ where: { phone: local }, orderBy: { id: "desc" }, select: { id: true, code: true, name: true } });

  const firstEver = (await db.inboxMessage.count({ where: { waId } })) === 0;
  const row = await db.inboxMessage.create({
    data: { waId, name: b.name ? String(b.name).slice(0, 80) : null, direction: "IN", body: body.slice(0, 4000), orderId: order?.id ?? null, status: "ok" },
  });
  await logApp("INFO", "WHATSAPP", `inbound from ${local}${order ? ` (${order.code})` : ""}: ${body.slice(0, 80)}`, { waId, inboxId: row.id });

  const { notifyAdmin } = await import("@/lib/notify");
  notifyAdmin("inbox", `💬 WhatsApp: ${order?.name || b.name || local}`,
    body.slice(0, 160) + (order ? ` · ${order.code}` : " · kono order nai"), order?.code || local).catch(() => {});

  /* ── STOP / opt-out pipeline (Phase 3, plan §9C) ──────────────────────────────────────────
     A customer writing STOP is taken out of marketing for good and gets one polite confirmation.
     Order updates still reach them afterwards — those are their own order's information, not an
     offer. Writing anything else counts as consent to be messaged (they started the conversation). */
  let optedOut = false;
  let optedIn = false;
  const stopWord = /^(stop|unsubscribe|unsub|block|off|band|bandho|bondho)\b/i.test(body.trim()) ||
    /\b(stop|unsubscribe|band koro|bondho koro)\b/i.test(body.trim());
  try {
    if (stopWord) {
      await db.waOptOut.upsert({
        where: { waId },
        update: { reason: body.slice(0, 200), source: "INBOUND" },
        create: { waId, reason: body.slice(0, 200), source: "INBOUND" },
      });
      if (order || local) {
        await db.customer.updateMany({ where: { phone: local }, data: { waOptIn: false, waOptInAt: null } }).catch(() => {});
      }
      optedOut = true;
      await logApp("WARN", "WHATSAPP", `${local} wrote STOP — marketing off (order updates still go)`, { waId });
      // confirmation goes through the same outbox so it is logged and visible in the inbox
      const { enqueue } = await import("@/lib/wa-queue");
      const confirm = "Thik ache, apnake offer list theke bad diyechi ✅\nOrder-er update (confirm/ship/deliver) amra age-er moto pathabo. Abar offer pete chaile SHURU likhun.";
      await enqueue({ to: waId, body: confirm, kind: "REPLY", meta: { stopConfirm: true } });
      await db.inboxMessage.create({ data: { waId, name: null, direction: "OUT", body: confirm, orderId: order?.id ?? null, status: "ok" } }).catch(() => {});
    } else {
      // a customer writing to us (first time or not) is consent to keep talking to them
      const cust = await db.customer.findUnique({ where: { phone: local } }).catch(() => null);
      if (cust && !cust.waOptIn) {
        const stop = await db.waOptOut.findUnique({ where: { waId } }).catch(() => null);
        if (!stop) {
          await db.customer.update({ where: { id: cust.id }, data: { waOptIn: true, waOptInAt: new Date() } }).catch(() => {});
          optedIn = true;
        }
      }
    }
  } catch { /* the inbox must never fail because the opt-out bookkeeping had a bad day */ }

  /* Optional greeting: only the very first message from a number, and only if the owner wrote
     one in Settings. Sending it is best-effort — an unlinked bridge must not 500 the webhook. */
  let autoReplied = false;
  try {
    const s = envFallback(await getSettings());
    const greeting = (s as any).notifications?.waAutoReply;
    if (firstEver && greeting && String(greeting).trim()) {
      const text = String(greeting).replace(/\{name\}/g, b.name || "apni").slice(0, 1000);
      const r = await waSend(waId, text);
      if (r.ok) {
        await db.inboxMessage.create({ data: { waId, name: null, direction: "OUT", body: text, orderId: order?.id ?? null, status: "ok" } });
        autoReplied = true;
      }
    }
  } catch {}

  return NextResponse.json({ ok: true, id: row.id, linkedOrder: order?.code || null, autoReplied, optedOut });
}
