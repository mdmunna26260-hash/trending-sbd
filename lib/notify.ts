import { db } from "./db";
import { getSettings, envFallback } from "./settings";
import { waSend, waStatus } from "./wa";
const emailText = (value: string) => value.replace(/[&<>"\']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/* Notification abstraction (PDF §38): in-app center (always) + Telegram + SMTP email.
   Channels are independent; unconfigured channels are skipped honestly (never faked). */
export type NotifyEvent =
  | "order.placed" | "order.confirmed" | "order.cancelled" | "order.shipped" | "order.delivered"
  | "payment" | "sms" | "waitlist" | "inbox" | "backup" | "test";

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j: any = await res.json().catch(() => ({}));
    return res.ok && j.ok;
  } catch { return false; }
}

/* SPAM-DELIVERABILITY NOTES (why emails landed in Gmail spam before):
   1. Bare-email From header (no friendly name) 2. HTML-only body without a text
   part 3. No sender identity in the footer 4. No reply path. Fixed below:
   friendly From aligned to the authenticated Gmail account, Reply-To,
   plain-text alternative part, identity footer. Gmail shows "Report not spam"
   once a recipient marks it — deliverability then improves for later mails. */
function fromHeader(cfg: any, s?: any): string {
  const brand = s?.store?.name || "TRENDING'S";
  const email = cfg.user || cfg.from;
  return cfg.from && cfg.from !== email ? `${brand} <${cfg.from}>` : `${brand} <${email}>`;
}

async function sendMail(cfg: any, to: string, subject: string, html: string, text?: string, s?: any): Promise<boolean> {
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: cfg.host, port: Number(cfg.port) || 587, secure: !!cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({
      from: fromHeader(cfg, s),
      replyTo: cfg.user,
      to,
      subject,
      html,
      text: text || html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Entity-Ref-ID": String(Date.now()),
      },
    });
    return true;
  } catch { return false; }
}

function emailHtml(title: string, body: string, storeName = "TRENDING'S"): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#141414">
    <div style="font-size:22px;letter-spacing:.25em;border-bottom:2px solid #141414;padding-bottom:12px;margin-bottom:18px">${storeName}</div>
    <h2 style="margin:0 0 10px">${title}</h2>
    <div style="font-size:14px;line-height:1.7;color:#444;white-space:pre-line">${body}</div>
    <div style="margin-top:26px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
      This is an automated service message about your order — sent because you shopped with ${storeName}.<br>
      Questions? Just reply to this email — it reaches our support inbox.
    </div>
  </div>`;
}

export async function notifyAdmin(evt: NotifyEvent, title: string, body: string, ref?: string): Promise<{ inApp: boolean; telegram: boolean | null; email: boolean | null; whatsapp: boolean | null }> {
  // 1) in-app notification center (always)
  let inApp = true;
  try { await db.notification.create({ data: { type: evt, title, body, ref } }); } catch { inApp = false; }
  // 2) channels
  let telegram: boolean | null = null;
  let email: boolean | null = null;
  let whatsapp: boolean | null = null;
  try {
    const s = envFallback(await getSettings());
    const n = s.notifications || {};
    const key = evt.replace(".", "_");
    const eventOn = evt === "test" || n[key] !== false;
    if (n.enabled !== false && eventOn) {
      if (n.telegramBotToken && n.telegramChatId) {
        telegram = await sendTelegram(n.telegramBotToken, n.telegramChatId, `<b>${title}</b>\n${body}`);
      }
      if (n.smtp?.host && n.smtp?.user && n.smtp?.pass && n.notifyEmail) {
        email = await sendMail(n.smtp, n.notifyEmail, `[TRENDING'S] ${title}`, emailHtml(title, body, s.store?.name), undefined, s);
      }
      if (n.waEnabled !== false && n.waNotifyNumber) {
        const st = await waStatus();
        if (st.connected) {
          const lines = body.replace(/<[^>]+>/g, "");
          whatsapp = (await waSend(n.waNotifyNumber, `*${title}*\n${lines}${ref ? `\nRef: ${ref}` : ""}`)).ok;
        } else whatsapp = false;
      }
    }
  } catch {}
  return { inApp, telegram, email, whatsapp };
}

/* Canonical public site URL for links inside emails */
export function storeUrl(s: any): string {
  const raw = s?.seo?.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "";
  const url = String(raw).trim();
  if (url.startsWith("http")) return url.replace(/\/$/, "");
  if (url) return "https://" + url.replace(/\/$/, "");
  return "https://sinzooffcial.com";
}

/* Email action buttons (invoice / track) — table-based, email-client safe */
function actionButtons(url: string, code: string): string {
  const inv = `${url}/invoice/${code}`;
  const trk = `${url}/track?code=${code}`;
  return `<table style="margin-top:20px;border-collapse:collapse"><tr>
    <td style="padding-right:12px"><a href="${inv}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;padding:12px 22px;font-size:12px;letter-spacing:.14em;text-transform:uppercase">View Invoice</a></td>
    <td><a href="${trk}" style="display:inline-block;background:#fff;color:#141414;border:1px solid #141414;text-decoration:none;padding:12px 22px;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Track Order</a></td>
  </tr></table>`;
}

/* Customer-facing order confirmation email (used at checkout when email is given). */
export async function emailCustomerOrder(to: string, name: string, order: { code: string; total: number; area: string; items: { title: string; qty: number; price: number }[] }) {
  try {
    const s = envFallback(await getSettings());
    const n = s.notifications || {};
    if (!n.smtp?.host || !n.smtp?.user || !n.smtp?.pass) return { configured: false };
    const rows = order.items.map((i) => `<tr><td style="padding:6px 0">${emailText(i.title)} × ${i.qty}</td><td style="text-align:right">৳${Math.round(i.price * i.qty).toLocaleString("en-IN")}</td></tr>`).join("");
    const url = storeUrl(s);
    const html = emailHtml(
      `Thank you for your order, ${emailText(name)}!`,
      `Order <b>${order.code}</b> received. We'll call you shortly to confirm.<br><br>
       <table style="width:100%;border-collapse:collapse">${rows}</table>
       <div style="border-top:2px solid #141414;margin-top:8px;padding-top:8px;font-weight:700">Total: ৳${Math.round(order.total).toLocaleString("en-IN")} (COD)</div>
       <div style="margin-top:8px;color:#666">Estimated delivery: ${order.area === "INSIDE_DHAKA" ? "1–2 days (Inside Dhaka)" : "2–4 days (Outside Dhaka)"}</div>
       ${actionButtons(url, order.code)}`
    );
    const brand = s.store?.name || "TRENDING'S";
    const ok = await sendMail(n.smtp, to, `${brand}: Order ${order.code} confirmed`, html, undefined, s);
    return { configured: true, ok };
  } catch { return { configured: false, ok: false }; }
}

/* Customer order-STATUS emails: courier in review / rider assigned / cancelled. */
export type OrderStatusEmailKind = "in_review" | "rider" | "cancelled" | "shipped";
export async function emailCustomerStatus(
  to: string, name: string,
  order: { code: string; total: number; area: string; courierName?: string | null },
  kind: OrderStatusEmailKind
) {
  try {
    const s = envFallback(await getSettings());
    const n = s.notifications || {};
    if (!n.smtp?.host || !n.smtp?.user || !n.smtp?.pass) return { configured: false };
    if (!to) return { configured: true, ok: false, skipped: "no email" };
    const url = storeUrl(s);
    const courier = order.courierName || "Steadfast";
    let title = "", body = "", subject = "";
    if (kind === "in_review") {
      subject = `TRENDING'S: Order ${order.code} received by ${courier}`;
      title = `Your order is with ${courier}`;
      body = `Hi ${name},<br><br>Apnar order <b>${order.code}</b> amra <b>${courier}</b>-er kache diye diyechi. Ekhon courier review cholche — verify holei rider pickup korbe.<br><br>
        Delivery: ${order.area === "INSIDE_DHAKA" ? "1–2 days (Inside Dhaka)" : "2–4 days (Outside Dhaka)"} · Amount payable: <b>৳${Math.round(order.total).toLocaleString("en-IN")}</b> (Cash on Delivery).<br><br>
        Niche Track Order click kore kokhono e kokhono parcel kothay ache dekhte parben.`;
    } else if (kind === "rider") {
      subject = `TRENDING'S: Order ${order.code} out for delivery`;
      title = "Rider assigned — parcel is on the way";
      body = `Hi ${name},<br><br>Good news! Apnar parcel <b>${order.code}</b> rider er kache — ekhon delivery er pothe.<br><br>
        <b>Phone khule rakhben</b> — rider delivery-er age call korte pare. Amount payable: <b>৳${Math.round(order.total).toLocaleString("en-IN")}</b> (Cash on Delivery).`;
    } else if (kind === "cancelled") {
      subject = `TRENDING'S: Order ${order.code} cancelled`;
      title = `Order ${order.code} has been cancelled`;
      body = `Hi ${name},<br><br>Apnar order <b>${order.code}</b> cancel kora hoyeche. Eta Cash on Delivery order chhilo, tai apnar kono taka jay ni — kono chinta nai.<br><br>
        Bhul ba onno kono proyojon hole amader WhatsApp/phone e janaben — abar order kore dibo.`;
    } else {
      subject = `TRENDING'S: Order ${order.code} shipped`;
      title = `Order ${order.code} has been shipped`;
      body = `Hi ${name}, apnar order ship kora hoyeche. Shighroi e pouchabe.`;
    }
    const html = emailHtml(title, body + actionButtons(url, order.code));
    const ok = await sendMail(n.smtp, to, subject, html, undefined, s);
    return { configured: true, ok };
  } catch { return { configured: false, ok: false }; }
}
