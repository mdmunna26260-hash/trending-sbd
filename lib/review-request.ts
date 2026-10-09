import { db } from "./db";
import { waSend } from "./wa";
import { sendSms, smsConfigured } from "./sms";
import { logApp } from "./logs";
import type { SettingsMap } from "./settings";

/* Post-delivery review request.
   Reviews are what turn a product page into a shelf people trust (and they are the only lawful
   way to get star ratings into Google). So after a parcel is actually delivered, ask — once —
   over whichever channel the shop has: WhatsApp bridge → SMS gateway → email. */

export function autoReviewRequestEnabled(s: SettingsMap): boolean {
  return ((s as any).reviews || {}).autoRequest === true;
}

export type ReviewRequestResult = { ok: boolean; channel?: "whatsapp" | "sms" | "email"; error?: string; skipped?: string };

export async function sendReviewRequest(orderId: number, s: SettingsMap, opts: { force?: boolean } = {}): Promise<ReviewRequestResult> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status !== "DELIVERED") return { ok: false, skipped: `${order.code} is ${order.status}, not delivered yet` };
  if (order.reviewRequestedAt && !opts.force) return { ok: false, skipped: `${order.code} already asked (${order.reviewRequestedAt.toISOString().slice(0, 10)})` };

  const productId = order.items.find((i) => i.productId)?.productId;
  const product = productId ? await db.product.findUnique({ where: { id: productId }, select: { slug: true, title: true } }) : null;
  const base = (s as any).seo?.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com";
  const link = product ? `${base}/products/${product.slug}#reviews` : `${base}/account`;
  const msg = `TRENDING'S: ${order.name}, apnar order ${order.code} deliver hoyeche. Ekta chhoto review dile amader onek help hoy — 1 minute: ${link}`;

  let channel: ReviewRequestResult["channel"];
  let error = "";
  const wa = await waSend(order.phone, msg);
  if (wa.ok) channel = "whatsapp";
  else if (smsConfigured(s)) {
    const r = await sendSms(s, order.phone, msg, "review-request");
    if (r.ok) channel = "sms";
    else error = r.error || "SMS failed";
  } else error = wa.error || "No WhatsApp bridge or SMS gateway configured";

  if (!channel && order.email) {
    try {
      const smtp = (s as any).notifications?.smtp || {};
      if (smtp.host) {
        const nodemailer = await import("nodemailer");
        const t = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port) || 587, secure: Number(smtp.port) === 465, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined });
        await t.sendMail({
          from: smtp.from || smtp.user, to: order.email,
          subject: `Apnar review — ${order.code}`,
          text: msg, html: `<p>${order.name}, apnar order <b>${order.code}</b> deliver hoyeche.</p><p>Ekta chhoto review dile amader onek help hoy — <a href="${link}">1 minute</a>.</p>`,
        });
        channel = "email";
      }
    } catch (e: any) {
      error = String(e?.message || e).slice(0, 160);
    }
  }

  if (!channel) {
    await logApp("WARN", "WHATSAPP", `review request for ${order.code} not sent — ${error}`, { orderId });
    return { ok: false, error };
  }
  await db.order.update({ where: { id: orderId }, data: { reviewRequestedAt: new Date() } });
  await logApp("INFO", channel === "email" ? "MAIL" : channel === "sms" ? "SMS" : "WHATSAPP", `review request sent for ${order.code} via ${channel}`, { orderId });
  return { ok: true, channel };
}

/** Orders that were delivered and never asked yet — the queue on the reviews screen. */
export async function reviewRequestQueue(limit = 100) {
  return db.order.findMany({
    where: { status: "DELIVERED", reviewRequestedAt: null },
    orderBy: { id: "desc" }, take: limit,
    select: { id: true, code: true, name: true, phone: true, total: true, email: true, updatedAt: true },
  });
}

export async function reviewRequestStats() {
  const [asked, pending, withReviews] = await Promise.all([
    db.order.count({ where: { reviewRequestedAt: { not: null } } }),
    db.order.count({ where: { status: "DELIVERED", reviewRequestedAt: null } }),
    db.review.count({ where: { status: "APPROVED" } }),
  ]);
  return { asked, pending, withReviews };
}
