import { db } from "./db";
import { getSettings, envFallback, type SettingsMap } from "./settings";
import { logApp } from "./logs";

/* SMS through a Bangladeshi gateway (admin menu item 7).
   Configured in Settings → Notifications → SMS: provider, sender id, api key, optional custom GET
   URL. A BD customer reads SMS, not email — but nothing here ever pretends a message went out:
   an unconfigured gateway refuses the send and says so, and every attempt (sent or failed) lands
   in the app log with the gateway's own reply. */

export type SmsCfg = {
  enabled?: boolean;
  provider?: string;
  senderId?: string;
  apiKey?: string;
  /** only for the "custom" provider — a URL template with {to} {message} {key} {sender} */
  url?: string;
  /** MIM SMS wants a user name next to the api key */
  user?: string;
};

export const SMS_PROVIDERS = [
  { id: "bulksmsbd", label: "BulkSMSBD (bulksmsbd.net)" },
  { id: "greenweb", label: "GreenWeb (api.greenweb.com.bd)" },
  { id: "mimsms", label: "MIM SMS" },
  { id: "custom", label: "Custom URL template" },
] as const;

/** The texts a BD shop actually sends. `{…}` placeholders are filled per order. */
export const SMS_TEMPLATES: { id: string; label: string; body: string }[] = [
  { id: "confirmed", label: "Order confirmed", body: "TRENDING'S: {name}, apnar order {code} confirm hoyeche. Total {amount}. Dhonnobad!" },
  { id: "packed", label: "Packed", body: "TRENDING'S: order {code} pack hoye gelo, aj courier e jabe." },
  { id: "shipped", label: "Handed to courier", body: "TRENDING'S: order {code} courier e deya hoyeche ({courier}). Tracking: {tracking}" },
  { id: "delivered", label: "Delivered", body: "TRENDING'S: order {code} deliver hoyeche. Kono problem thakle ei number e janan — dhonnobad!" },
  { id: "cancelled", label: "Cancelled", body: "TRENDING'S: order {code} cancel kora hoyeche. Jante chai keno — reply korun." },
  { id: "due", label: "Cash on delivery reminder", body: "TRENDING'S: order {code} er {amount} cash delivery-r somoy diben. Rider {area} e jacche." },
  { id: "waitlist", label: "Back in stock", body: "TRENDING'S: {product} abar stock e eseche! Ekhon order korun: {link}" },
  { id: "custom", label: "Blank / custom text", body: "" },
];

export function smsCfg(s: SettingsMap): SmsCfg {
  return ((s as any).notifications?.sms || {}) as SmsCfg;
}

/** A gateway is only "configured" when it can actually deliver: key + (sender id or a custom URL). */
export function smsConfigured(s: SettingsMap): boolean {
  const c = smsCfg(s);
  return !!(c.enabled !== false && c.apiKey && (c.senderId || c.provider === "custom"));
}

/** 01712345678 / 8801712345678 / +8801712345678 → 8801712345678 (gateways want the country code). */
export function normalizeBdPhone(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("880")) return d;
  if (d.startsWith("0")) return "880" + d.slice(1);
  if (d.length === 10) return "880" + d;
  return d;
}

export function fillTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return String(text || "").replace(/\{(\w+)\}/g, (_m, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export type SmsResult = { ok: boolean; error?: string; response?: string; skipped?: string };

function buildUrl(c: SmsCfg, number: string, text: string): { url: string; error?: string } {
  const provider = String(c.provider || "bulksmsbd").toLowerCase();
  const key = String(c.apiKey || "");
  const sender = String(c.senderId || "");
  if (provider === "custom") {
    const tpl = String(c.url || "").trim();
    if (!tpl) return { url: "", error: "Custom provider needs a URL template" };
    return {
      url: tpl
        .replace(/\{to\}|\{number\}/g, number)
        .replace(/\{message\}|\{text\}/g, encodeURIComponent(text))
        .replace(/\{key\}/g, encodeURIComponent(key))
        .replace(/\{sender\}/g, encodeURIComponent(sender)),
    };
  }
  if (provider === "greenweb") {
    return { url: `https://api.greenweb.com.bd/api.php?token=${encodeURIComponent(key)}&to=${number}&message=${encodeURIComponent(text)}` };
  }
  if (provider === "mimsms") {
    return { url: `https://api.mimsms.com/api/SmsSending/Send?UserName=${encodeURIComponent(c.user || "")}&ApiKey=${encodeURIComponent(key)}&SenderName=${encodeURIComponent(sender)}&MobileNumber=${number}&TransactionType=T&Message=${encodeURIComponent(text)}` };
  }
  // default: BulkSMSBD
  return { url: `http://bulksmsbd.net/api/smsapi?api_key=${encodeURIComponent(key)}&type=text&number=${number}&senderid=${encodeURIComponent(sender)}&message=${encodeURIComponent(text)}` };
}

/** Send one SMS. `kind` is only a log label (manual / bulk / template:shipped / waitlist …). */
export async function sendSms(s: SettingsMap, to: string, message: string, kind = "manual"): Promise<SmsResult> {
  const number = normalizeBdPhone(to);
  const text = String(message || "").slice(0, 1000);
  if (!number || number.length < 11) return { ok: false, error: "Invalid phone number" };
  if (!text.trim()) return { ok: false, error: "Empty message" };

  const c = smsCfg(s);
  if (!smsConfigured(s)) {
    await logApp("WARN", "SMS", `${number} e SMS jay nai (gateway configure kora nai): ${text.slice(0, 80)}`, { kind });
    return { ok: false, skipped: "SMS gateway is not configured (Settings → Notifications → SMS Gateway)", error: "SMS gateway is not configured" };
  }

  const { url, error } = buildUrl(c, number, text);
  if (error) return { ok: false, error };

  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
    const body = (await res.text().catch(() => "")).slice(0, 300);
    const ok = res.ok && !/\b(error|invalid|fail|failed)\b/i.test(body);
    await logApp(ok ? "INFO" : "ERROR", "SMS", `${ok ? "sent" : "FAILED"} → ${number}: ${text.slice(0, 90)}`, { kind, provider: c.provider || "bulksmsbd", httpStatus: res.status, response: body });
    return { ok, response: body, error: ok ? undefined : `Gateway said: ${body || res.status}` };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    await logApp("ERROR", "SMS", `gateway call failed → ${number}`, { kind, error: msg });
    return { ok: false, error: msg };
  }
}

type SmsOrderLike = {
  code: string;
  name: string;
  phone: string;
  total: number;
  area?: string | null;
  courierName?: string | null;
  courierConsignmentId?: string | null;
  items?: { title: string }[];
};

/** The text for one event, with the order's real values filled in. */
export function orderSmsText(order: SmsOrderLike, event: string, s?: SettingsMap): string {
  const custom = s ? (((s as any).notifications?.smsTemplates?.[event] as string) || "") : "";
  const template = custom || SMS_TEMPLATES.find((t) => t.id === event)?.body || "";
  return fillTemplate(template, {
    name: order.name,
    code: order.code,
    amount: "৳" + Math.round(order.total).toLocaleString("en-IN"),
    courier: order.courierName || "courier",
    tracking: order.courierConsignmentId || order.code,
    area: order.area === "INSIDE_DHAKA" ? "Dhaka" : order.area || "",
    items: (order.items || []).map((i) => i.title).join(", ").slice(0, 60),
    site: (s as any)?.seo?.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "",
  });
}

/** Called by the order API whenever the status changes: sends only if the owner switched that
    status on, and never throws — an order update must not fail because a gateway is down. */
export async function autoSmsOnStatus(s: SettingsMap, status: string, order: SmsOrderLike): Promise<SmsResult | null> {
  try {
    if (!smsEnabledForStatus(s, status)) return null;
    const event = String(status || "").toLowerCase();
    const text = orderSmsText(order, event, s);
    if (!text.trim()) return null;
    return await sendSms(s, order.phone, text, "auto:" + event);
  } catch (e: any) {
    await logApp("ERROR", "SMS", `auto SMS on ${status} failed: ${String(e?.message || e).slice(0, 160)}`, { order: order?.code });
    return null;
  }
}

/** The switch a shop owner flips in Settings: "SMS on <status>" (sms_on_confirmed …). */
export function smsEnabledForStatus(s: SettingsMap, status: string): boolean {
  if (!smsConfigured(s)) return false;
  const key = "sms_on_" + String(status || "").toLowerCase();
  return ((s as any).notifications?.[key] === true) || (((s as any).notifications?.sms?.on || {})[String(status || "").toLowerCase()] === true);
}

/** Small counters for the SMS screen header. */
export async function smsStats() {
  const since = new Date(Date.now() - 86400_000);
  const [day, week] = await Promise.all([
    db.appLog.findMany({ where: { kind: "SMS", createdAt: { gte: since } }, select: { level: true } }),
    db.appLog.findMany({ where: { kind: "SMS" }, orderBy: { id: "desc" }, take: 200, select: { level: true } }),
  ]);
  return {
    last24h: day.length,
    last24hFailed: day.filter((l) => l.level !== "INFO").length,
    recentFailed: week.filter((l) => l.level !== "INFO").length,
  };
}
