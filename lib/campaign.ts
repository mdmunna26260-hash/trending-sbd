import { db } from "./db";
import { getSettings, envFallback, type SettingsMap } from "./settings";
import { storeUrl } from "./notify";
import { unsubscribeToken } from "./auth";

/* Newsletter campaigns — the bulk-mail half of the abandoned-cart mailer.
   Rules that matter:
   · only subscribers who never unsubscribed are mailed (Subscriber.unsubscribed)
   · every mail carries a signed one-click unsubscribe link (HMAC of the address) and
     List-Unsubscribe headers, which is what Gmail/Yahoo now expect from bulk senders
   · a send runs in batches of N across several requests, so a 2000-address list neither
     times out nor blocks the admin UI — Campaign.cursorId remembers where it got to
   · SENT is final: pressing send again cannot double-mail the list */

export type BatchResult = { sent: number; failed: number; remaining: number; done: boolean; error?: string };

export const BATCH = 40;

export async function audienceCount(): Promise<number> {
  return db.subscriber.count({ where: { unsubscribed: false } });
}

/* The public unsubscribe URL for one address. Signed, so nobody can unsubscribe a stranger. */
export function unsubscribeUrl(base: string, email: string): string {
  return `${base}/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&k=${unsubscribeToken(email)}`;
}

function bodyToHtml(body: string, ctaLabel?: string | null, ctaUrl?: string | null): string {
  const paras = String(body || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const h = p.match(/^#{2,3}\s*(.+)$/);
      if (h) return `<h2 style="font-size:19px;margin:26px 0 10px;font-weight:600">${esc(h[1])}</h2>`;
      return `<p style="margin:0 0 16px;font-size:14.5px;line-height:1.75;color:#3b3833">${esc(p.replace(/\n/g, "<br>"))}</p>`;
    })
    .join("\n");
  const cta = ctaLabel && ctaUrl
    ? `<div style="margin:26px 0 8px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;padding:14px 30px;font-size:12px;letter-spacing:.14em;text-transform:uppercase">${esc(ctaLabel)}</a></div>`
    : "";
  return paras + cta;
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Full HTML mail for one recipient. */
export function campaignHtml(opts: {
  subject: string; body: string; ctaLabel?: string | null; ctaUrl?: string | null;
  storeName: string; unsub: string; url: string; landing?: string;
}) {
  const { subject, storeName, unsub, url } = opts;
  return `<!doctype html><html><body style="margin:0;background:#faf9f7">
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:28px 22px;color:#141414">
    <div style="font-size:21px;letter-spacing:.28em;border-bottom:2px solid #141414;padding-bottom:12px">${esc(storeName)}</div>
    <h1 style="font-size:23px;line-height:1.3;margin:24px 0 18px;font-weight:600">${esc(subject)}</h1>
    ${bodyToHtml(opts.body, opts.ctaLabel, opts.ctaUrl)}
    <div style="margin-top:30px;padding-top:14px;border-top:1px solid #e5e1da;font-size:11px;line-height:1.7;color:#8a857e">
      You are getting this because you asked for updates from ${esc(storeName)}.<br>
      <a href="${esc(unsub)}" style="color:#8a857e;text-decoration:underline">Unsubscribe</a> ·
      <a href="${esc(opts.landing || url)}" style="color:#8a857e;text-decoration:underline">Visit the store</a>
    </div>
  </div></body></html>`;
}

async function transportFor(s: SettingsMap) {
  const n = s.notifications || {};
  if (!n.smtp?.host || !n.smtp?.user || !n.smtp?.pass) return null;
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({
    host: n.smtp.host, port: Number(n.smtp.port) || 587,
    auth: { user: n.smtp.user, pass: n.smtp.pass },
  });
}

/** Send one preview of a campaign to a single address (admin presses "send test"). */
export async function sendTest(campaign: { subject: string; body: string; ctaLabel?: string | null; ctaUrl?: string | null }, to: string) {
  const s = envFallback(await getSettings());
  const transport = await transportFor(s);
  if (!transport) return { ok: false, error: "SMTP is not configured (Settings → Notifications)." };
  const url = storeUrl(s);
  const brand = s.store?.name || "TRENDING'S";
  const html = campaignHtml({ ...campaign, storeName: brand, unsub: unsubscribeUrl(url, to), url });
  try {
    await transport.sendMail({
      from: `${brand} <${s.notifications!.smtp!.user}>`,
      replyTo: s.notifications!.smtp!.user,
      to,
      subject: `[TEST] ${campaign.subject}`,
      html,
      text: `${campaign.subject}\n\n${campaign.body}\n\n(test send)`,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Send failed" };
  }
}

/** Send the next batch of one campaign. Safe to call repeatedly until `done`. */
export async function sendBatch(campaignId: number): Promise<BatchResult> {
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c) return { sent: 0, failed: 0, remaining: 0, done: true, error: "Campaign not found" };
  if (c.status === "SENT") return { sent: 0, failed: 0, remaining: 0, done: true };

  const s = envFallback(await getSettings());
  const transport = await transportFor(s);
  if (!transport) return { sent: 0, failed: 0, remaining: await audienceCount(), done: false, error: "SMTP is not configured (Settings → Notifications)." };

  const url = storeUrl(s);
  const brand = s.store?.name || "TRENDING'S";

  const rows = await db.subscriber.findMany({
    where: { unsubscribed: false, id: { gt: c.cursorId } },
    orderBy: { id: "asc" },
    take: BATCH,
  });

  if (rows.length === 0) {
    await db.campaign.update({ where: { id: c.id }, data: { status: "SENT", sentAt: new Date(), cursorId: 1 << 30 } });
    return { sent: 0, failed: 0, remaining: 0, done: true };
  }

  let sent = 0, failed = 0, cursor = c.cursorId;
  for (const row of rows) {
    const unsub = unsubscribeUrl(url, row.email);
    try {
      await transport.sendMail({
        from: `${brand} <${s.notifications!.smtp!.user}>`,
        replyTo: s.notifications!.smtp!.user,
        to: row.email,
        subject: c.subject,
        html: campaignHtml({ subject: c.subject, body: c.body, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl, storeName: brand, unsub, url }),
        text: `${c.subject}\n\n${c.body}\n\nUnsubscribe: ${unsub}`,
        /* Gmail/Yahoo require bulk senders to offer one-click unsubscribe; the POST endpoint
           (RFC 8058) is handled by the same route as the human-clickable link. */
        headers: {
          "List-Unsubscribe": `<${unsub}>, <mailto:${s.notifications!.smtp!.user}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "Auto-Submitted": "auto-generated",
        },
      });
      sent++;
    } catch {
      failed++;
    }
    cursor = row.id;
  }

  const remaining = await db.subscriber.count({ where: { unsubscribed: false, id: { gt: cursor } } });
  await db.campaign.update({
    where: { id: c.id },
    data: {
      sent: { increment: sent },
      failed: { increment: failed },
      cursorId: cursor,
      total: c.total || rows.length + remaining,
      status: remaining > 0 ? "SENDING" : "SENT",
      ...(remaining > 0 ? {} : { sentAt: new Date() }),
    },
  });
  return { sent, failed, remaining, done: remaining === 0 };
}
