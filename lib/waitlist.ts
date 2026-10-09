import { db } from "./db";
import { waSend } from "./wa";
import { sendSms, smsConfigured } from "./sms";
import { logApp } from "./logs";
import type { SettingsMap } from "./settings";

/* Out-of-stock waitlist.
   A sold-out product is a lost sale unless someone tells the customer the moment it is back.
   One contact per row (phone or email — whatever they typed), and the notify path uses whatever
   channel the shop actually has: WhatsApp bridge → SMS gateway → email. If none is configured the
   entry is kept and the admin screen offers a tap-to-send wa.me / mailto link, so the lead is
   never silently dropped. */

export type WaitlistEntry = {
  id: number; productId: number; variantId: number | null; contact: string; note: string | null;
  notifiedAt: Date | null; createdAt: Date;
};

export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function waitlistMessage(productTitle: string, variant?: string | null, url?: string): string {
  const v = variant ? ` (${variant})` : "";
  return `TRENDING'S: apni je "${productTitle}"${v} er jonno wait korechilen — seta abar stock-e esheche! Take a look: ${url || "https://sinzooffcial.com"}`;
}

export type NotifyResult = { ok: boolean; channel: "whatsapp" | "sms" | "email" | "manual"; error?: string; link?: string };

/** Tell one waitlister. Returns the channel actually used (or "manual" + a link to send by hand). */
export async function notifyWaitlistEntry(entry: WaitlistEntry, s: SettingsMap): Promise<NotifyResult> {
  const product = await db.product.findUnique({ where: { id: entry.productId }, select: { title: true, slug: true } });
  const variant = entry.variantId ? await db.productVariant.findUnique({ where: { id: entry.variantId }, select: { size: true, color: true } }) : null;
  const vLabel = variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : null;
  const base = (s as any).seo?.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com";
  const url = product ? `${base}/products/${product.slug}` : base;
  const msg = waitlistMessage(product?.title || "product", vLabel, url);
  const contact = entry.contact.trim();

  if (!looksLikeEmail(contact)) {
    const wa = await waSend(contact, msg);
    if (wa.ok) {
      await markNotified(entry.id);
      await logApp("INFO", "WHATSAPP", `waitlist #${entry.id} → WhatsApp ${contact}`);
      return { ok: true, channel: "whatsapp" };
    }
    if (smsConfigured(s)) {
      const r = await sendSms(s, contact, msg, "waitlist");
      if (r.ok) {
        await markNotified(entry.id);
        return { ok: true, channel: "sms" };
      }
    }
    return { ok: false, channel: "manual", error: "No WhatsApp/SMS channel available", link: `https://wa.me/${contact.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` };
  }

  // email
  try {
    const smtp = (s as any).notifications?.smtp || {};
    if (!smtp.host) return { ok: false, channel: "manual", error: "SMTP is not configured", link: `mailto:${contact}?subject=${encodeURIComponent("Back in stock — TRENDING'S")}&body=${encodeURIComponent(msg)}` };
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port) || 587, secure: Number(smtp.port) === 465, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined });
    await t.sendMail({
      from: smtp.from || smtp.user, to: contact,
      subject: `Back in stock — ${product?.title || "TRENDING'S"}`,
      text: msg, html: `<p>${msg.replace(url, `<a href="${url}">${url}</a>`)}</p>`,
    });
    await markNotified(entry.id);
    await logApp("INFO", "MAIL", `waitlist #${entry.id} → email ${contact}`);
    return { ok: true, channel: "email" };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 160);
    await logApp("ERROR", "MAIL", `waitlist #${entry.id} email failed: ${error}`);
    return { ok: false, channel: "manual", error, link: `mailto:${contact}?subject=${encodeURIComponent("Back in stock — TRENDING'S")}&body=${encodeURIComponent(msg)}` };
  }
}

export async function markNotified(id: number) {
  await db.waitlist.update({ where: { id }, data: { notifiedAt: new Date() } }).catch(() => {});
}

/** Restock → tell everyone waiting for that product (called after a stock increase). */
export async function notifyWaitlistForProduct(productId: number, s: SettingsMap, limit = 25): Promise<{ candidates: number; sent: number }> {
  const pending = await db.waitlist.findMany({ where: { productId, notifiedAt: null }, orderBy: { id: "asc" }, take: limit });
  if (!pending.length) return { candidates: 0, sent: 0 };
  const { notifyAdmin } = await import("./notify");
  /* sent in parallel: a restock should not hold the request open for one slow gateway call
     per customer. Capped above (limit) so a viral drop cannot fire 500 messages at once. */
  const results = await Promise.all(pending.map((e) => notifyWaitlistEntry(e as WaitlistEntry, s).catch(() => ({ ok: false } as NotifyResult))));
  const sent = results.filter((r) => r.ok).length;
  const product = await db.product.findUnique({ where: { id: productId }, select: { title: true } });
  await notifyAdmin("waitlist", `📣 Back in stock: ${product?.title || "#" + productId}`,
    `${pending.length} customer${pending.length === 1 ? "" : "s"} were waiting · ${sent} notified automatically${sent < pending.length ? ` · ${pending.length - sent} need a manual message (admin → Waitlist)` : ""}`,
    "product:" + productId).catch(() => {});
  return { candidates: pending.length, sent };
}

export async function waitlistStats() {
  const [total, pending, products] = await Promise.all([
    db.waitlist.count(),
    db.waitlist.count({ where: { notifiedAt: null } }),
    db.waitlist.findMany({ where: { notifiedAt: null }, select: { productId: true }, distinct: ["productId"] }),
  ]);
  return { total, pending, products: products.length };
}
