import { db } from "./db";
import { getSettings, envFallback } from "./settings";
import { logApp } from "./logs";
import { enqueue, clampText, renderTemplate, siteUrl, waRules, waPretty, WA_MEDIA_MAX } from "./wa-queue";
import type { SettingsMap } from "./settings";
import { catalogById, productCardText, productCardImage } from "./wa-messages";
import { resolveAudience, audienceRule, describeRule, defaultLinkTarget, type WaRecipient, type WaAudienceRule } from "./wa-audience";

/* WhatsApp broadcast campaigns (Phase 3).

   A campaign is created in the composer, and only when the owner presses Start is the audience
   resolved and *frozen* onto the row (`recipients`). From then on the worker's `advanceBroadcasts`
   walks that frozen list in small batches and drops one WaMessage per person into the same outbox
   the order messages use — so pacing, daily caps, quiet hours, retries, receipts and the SMS
   fallback all apply to campaigns for free. Nothing here sends anything by itself. */

export const WA_BROADCAST_BATCH = 25;         // recipients queued per worker tick
export const WA_BROADCAST_MAX = 20000;        // hard ceiling on one campaign
const AUTO_PAUSE_MIN_FAILED = 10;             // enough failures AND …
const AUTO_PAUSE_RATIO = 0.5;                 // … more than half of the attempts

export type BroadcastInput = {
  name?: string;
  body?: string;
  templateKey?: string | null;
  images?: string[];
  productIds?: number[];
  couponCode?: string | null;
  linkTarget?: string | null;
  shortLink?: boolean;
  audienceRule?: unknown;
  deviceIds?: number[];
  scheduledAt?: string | null;
};

export const WA_BROADCAST_STATUSES = ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "DONE", "FAILED"] as const;

export function broadcastStatusLabel(status: string): string {
  switch (status) {
    case "SCHEDULED": return "Schedule করা";
    case "RUNNING": return "চলছে";
    case "PAUSED": return "থামানো";
    case "DONE": return "শেষ";
    case "FAILED": return "সমস্যা";
    default: return "Draft";
  }
}

function slugify(input: string): string {
  return String(input || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function uniqueSlug(base: string): Promise<string> {
  const seed = slugify(base) || "promo";
  for (let i = 0; i < 40; i++) {
    const slug = i === 0 ? seed : `${seed}-${i + 1}`;
    const taken = await db.waLink.findUnique({ where: { slug } }).catch(() => null);
    if (!taken) return slug;
  }
  return `${seed}-${Date.now().toString(36)}`;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** The body one recipient gets: variables rendered + product cards + coupon + STOP line. */
export async function broadcastBodyFor(row: any, r: { name?: string | null }, s: SettingsMap, site: string): Promise<{ body: string; images: string[] }> {
  const rules = waRules(s);
  const productIds = parseJson<number[]>(row.productIds, []);
  const cards: string[] = [];
  const productImages: string[] = [];
  for (const id of productIds.slice(0, 3)) {
    const p = await catalogById(Number(id));
    if (!p) continue;
    cards.push(productCardText(p, site));
    productImages.push(...productCardImage(p, site));
  }

  const slug = row.linkSlug ? String(row.linkSlug) : null;
  const shortUrl = slug ? `${site}/l/${slug}` : "";
  const body = renderTemplate(String(row.body || ""), {
    name: r.name || "apni",
    store: (s as any)?.store?.name || "TRENDING'S",
    link: shortUrl || `${site}/products`,
    coupon: row.couponCode || rules.couponCode || "",
    date: new Date().toLocaleDateString("en-GB"),
  });

  const parts = [clampText(body, 3200).trim()];
  if (cards.length) parts.push(cards.join("\n\n"));
  if (row.couponCode) parts.push(`🎟️ Coupon: *${row.couponCode}* — order korar somoy likhun.`);
  if (rules.stopLine) parts.push("_Offer bondho korte chaile STOP likhun._");

  // images the owner uploaded win; otherwise the first product photo rides along
  const uploaded = parseJson<string[]>(row.images, []).filter(Boolean);
  const images = uploaded.length ? uploaded : productImages.slice(0, 1);
  return { body: clampText(parts.filter(Boolean).join("\n\n"), 4000), images: images.slice(0, WA_MEDIA_MAX) };
}

/* ── CRUD ───────────────────────────────────────────────────────────────────────────── */

export async function createBroadcast(input: BroadcastInput, user?: string | null): Promise<any> {
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});
  const name = String(input.name || "").trim().slice(0, 120) || `Campaign ${new Date().toLocaleDateString("en-GB")}`;
  const body = clampText(String(input.body || "").trim(), 4000);
  if (!body) throw new Error("Message body khali — kichu likhun.");

  const row = await db.waBroadcast.create({
    data: {
      name,
      body,
      templateKey: input.templateKey ? String(input.templateKey).slice(0, 60) : null,
      images: input.images?.length ? JSON.stringify(input.images.slice(0, WA_MEDIA_MAX)) : null,
      productIds: input.productIds?.length ? JSON.stringify(input.productIds.slice(0, 3).map(Number)) : null,
      couponCode: input.couponCode ? String(input.couponCode).slice(0, 40) : null,
      linkTarget: input.linkTarget ? String(input.linkTarget).slice(0, 500) : null,
      audienceRule: JSON.stringify(audienceRule(input.audienceRule)),
      deviceIds: input.deviceIds?.length ? JSON.stringify(input.deviceIds.map(Number)) : null,
      createdBy: user || null,
      status: "DRAFT",
    },
  });
  return row;
}

export async function updateBroadcast(id: number, patch: BroadcastInput): Promise<any> {
  const data: any = {};
  if (patch.name !== undefined) data.name = String(patch.name).trim().slice(0, 120);
  if (patch.body !== undefined) data.body = clampText(String(patch.body).trim(), 4000);
  if (patch.templateKey !== undefined) data.templateKey = patch.templateKey ? String(patch.templateKey).slice(0, 60) : null;
  if (patch.images !== undefined) data.images = patch.images.length ? JSON.stringify(patch.images.slice(0, WA_MEDIA_MAX)) : null;
  if (patch.productIds !== undefined) data.productIds = patch.productIds.length ? JSON.stringify(patch.productIds.slice(0, 3).map(Number)) : null;
  if (patch.couponCode !== undefined) data.couponCode = patch.couponCode ? String(patch.couponCode).slice(0, 40) : null;
  if (patch.linkTarget !== undefined) data.linkTarget = patch.linkTarget ? String(patch.linkTarget).slice(0, 500) : null;
  if (patch.audienceRule !== undefined) data.audienceRule = JSON.stringify(audienceRule(patch.audienceRule));
  if (patch.deviceIds !== undefined) data.deviceIds = patch.deviceIds.length ? JSON.stringify(patch.deviceIds.map(Number)) : null;
  if (patch.scheduledAt !== undefined) {
    const at = patch.scheduledAt ? new Date(patch.scheduledAt) : null;
    data.scheduledAt = at && !isNaN(at.getTime()) ? at : null;
    if (data.scheduledAt) data.status = "SCHEDULED";
  }
  return db.waBroadcast.update({ where: { id }, data });
}

/** Freeze the audience and put the campaign in the queue (or on the calendar). */
export async function startBroadcast(id: number): Promise<any> {
  const row = await db.waBroadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Campaign ta nei.");
  if (["RUNNING", "SCHEDULED"].includes(row.status)) return row;

  const s = envFallback(await getSettings());
  const site = siteUrl(s);
  const audience = await resolveAudience(row.audienceRule);
  const recipients: WaRecipient[] = audience.recipients.slice(0, WA_BROADCAST_MAX);

  // short link for click tracking (created once per campaign)
  let linkSlug = row.linkSlug;
  if (!linkSlug) {
    const ids = parseJson<number[]>(row.productIds, []);
    const firstProduct = ids.length ? await catalogById(Number(ids[0])) : null;
    const target = String(row.linkTarget || "").trim()
      || (firstProduct ? `${site}/products/${firstProduct.slug}` : "")
      || defaultLinkTarget(s);
    linkSlug = await uniqueSlug(`${row.name}-${id}`);
    await db.waLink.create({ data: { slug: linkSlug, target, label: row.name, broadcastId: id } }).catch(() => {});
  }

  const future = row.scheduledAt && row.scheduledAt.getTime() > Date.now() + 30_000;
  const updated = await db.waBroadcast.update({
    where: { id },
    data: {
      recipients: JSON.stringify(recipients),
      total: recipients.length,
      enqueued: 0,
      sent: 0, failed: 0, skipped: 0,
      linkSlug,
      status: future ? "SCHEDULED" : "RUNNING",
      startedAt: future ? null : new Date(),
      finishedAt: null,
      lastError: null,
    },
  });
  await logApp("INFO", "WHATSAPP",
    `campaign "${row.name}" ${future ? `scheduled for ${row.scheduledAt?.toISOString()}` : "started"} — ${recipients.length} recipient(s)`,
    { broadcastId: id, excluded: audience.excluded, site });
  return updated;
}

export async function pauseBroadcast(id: number, why?: string): Promise<any> {
  const row = await db.waBroadcast.update({ where: { id }, data: { status: "PAUSED", lastError: why || null } });
  // a paused campaign stops the queue moving for it: rows that are still waiting are put on hold
  await db.waMessage.updateMany({ where: { broadcastId: id, status: "QUEUED" }, data: { status: "SKIPPED", error: "campaign paused — baki gulo pathano hoy ni", lockedAt: null } });
  return row;
}

export async function resumeBroadcast(id: number): Promise<any> {
  const row = await db.waBroadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Campaign ta nei.");
  // rows skipped by the pause go back in line
  const back = await db.waMessage.updateMany({
    where: { broadcastId: id, status: "SKIPPED", error: { contains: "campaign paused" } },
    data: { status: "QUEUED", error: null, nextAttemptAt: null },
  });
  const updated = await db.waBroadcast.update({ where: { id }, data: { status: "RUNNING", finishedAt: null, lastError: null } });
  if (back.count) await logApp("INFO", "WHATSAPP", `campaign "${row.name}" resumed — ${back.count} message(s) back in the queue`, { broadcastId: id });
  return updated;
}

export async function deleteBroadcast(id: number): Promise<{ ok: boolean }> {
  const row = await db.waBroadcast.findUnique({ where: { id } });
  if (!row) return { ok: false };
  const running = await db.waMessage.count({ where: { broadcastId: id, status: { in: ["QUEUED", "SENDING"] } } });
  if (running) throw new Error("Campaign ta ekhono queue-te ache — আগে pause করুন, তারপর delete.");
  await db.waBroadcast.delete({ where: { id } }).catch(() => {});
  await db.waLink.deleteMany({ where: { broadcastId: id } }).catch(() => {});
  return { ok: true };
}

export async function duplicateBroadcast(id: number): Promise<any> {
  const row = await db.waBroadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Campaign ta nei.");
  return db.waBroadcast.create({
    data: {
      name: `${row.name} (copy)`.slice(0, 120),
      body: row.body,
      templateKey: row.templateKey,
      images: row.images,
      productIds: row.productIds,
      couponCode: row.couponCode,
      linkTarget: row.linkTarget,
      audienceRule: row.audienceRule,
      deviceIds: row.deviceIds,
      createdBy: row.createdBy,
      status: "DRAFT",
    },
  });
}

/** "Only the failures" — the report screen's rescue button. */
export async function retryFailed(id: number): Promise<{ ok: boolean; requeued: number }> {
  const rows = await db.waMessage.findMany({ where: { broadcastId: id, status: "FAILED" }, select: { id: true } });
  for (const r of rows) {
    await db.waMessage.update({ where: { id: r.id }, data: { status: "QUEUED", attempts: 0, error: null, nextAttemptAt: null, lockedAt: null } }).catch(() => {});
  }
  const row = await db.waBroadcast.findUnique({ where: { id } });
  if (row && rows.length) {
    await db.waBroadcast.update({ where: { id }, data: { status: "RUNNING", finishedAt: null, lastError: null } });
    await logApp("INFO", "WHATSAPP", `campaign "${row.name}" — retrying ${rows.length} failed message(s)`, { broadcastId: id });
  }
  return { ok: true, requeued: rows.length };
}

/* ── the worker hook ────────────────────────────────────────────────────────────────── */

/** Called at the top (and bottom) of every worker tick: promote due schedules, queue the next
    batch, update counters, finish or auto-pause. Never sends anything itself. */
export async function advanceBroadcasts(notes: string[] = []): Promise<{ started: number; enqueued: number; done: number; paused: number }> {
  const out = { started: 0, enqueued: 0, done: 0, paused: 0 };
  try {
    const s = envFallback(await getSettings());
    const site = siteUrl(s);
    const rules = waRules(s);

    // due schedules start
    const due = await db.waBroadcast.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, take: 5 }).catch(() => []);
    for (const b of due) {
      const started = await startBroadcast(b.id).catch(() => null);
      if (started) {
        out.started += 1;
        notes.push(`campaign "${b.name}" started (scheduled)`);
        if (started.status === "RUNNING") await db.waBroadcast.update({ where: { id: b.id }, data: { startedAt: new Date() } }).catch(() => {});
      }
    }

    const running = await db.waBroadcast.findMany({ where: { status: "RUNNING" }, orderBy: { id: "asc" }, take: 5 }).catch(() => []);
    for (const b of running) {
      const recipients = parseJson<WaRecipient[]>(b.recipients, []);
      const from = b.enqueued || 0;
      const batch = recipients.slice(from, from + WA_BROADCAST_BATCH);
      let queued = 0;
      let skipped = 0;
      for (const r of batch) {
        const built = await broadcastBodyFor(b, r, s, site);
        const res = await enqueue({
          to: r.to,
          body: built.body,
          kind: "BROADCAST",
          templateKey: b.templateKey || "broadcast",
          broadcastId: b.id,
          media: built.images,
          couponCode: b.couponCode || null,
          dedupeKey: `bc:${b.id}:${r.to}`,
          meta: { campaign: b.name, name: r.name || null, broadcastId: b.id },
        });
        if (res.ok) queued += 1;
        else { skipped += 1; notes.push(`campaign #${b.id} skipped ${waPretty(r.to)}: ${res.reason}`); }
      }
      out.enqueued += queued;
      if (batch.length) {
        await db.waBroadcast.update({ where: { id: b.id }, data: { enqueued: from + batch.length, skipped: { increment: skipped } } }).catch(() => {});
        if (queued) notes.push(`campaign "${b.name}": ${queued} message(s) queued`);
      }

      // counters + terminal state come from the messages themselves
      const rows = await db.waMessage.findMany({ where: { broadcastId: b.id }, select: { status: true } }).catch(() => []);
      const count = (st: string) => rows.filter((r) => r.status === st).length;
      const sent = count("SENT") + count("DELIVERED") + count("READ");
      const failed = count("FAILED");
      const skippedRows = count("SKIPPED");
      const pending = count("QUEUED") + count("SENDING");
      const allQueued = from + batch.length >= recipients.length;

      await db.waBroadcast.update({ where: { id: b.id }, data: { sent, failed, skipped: skippedRows } }).catch(() => {});

      if (failed >= AUTO_PAUSE_MIN_FAILED && failed / Math.max(1, sent + failed) > AUTO_PAUSE_RATIO) {
        await db.waBroadcast.update({ where: { id: b.id }, data: { status: "PAUSED", lastError: `Auto-paused: ${failed} ta message fail holo (${Math.round((failed / Math.max(1, sent + failed)) * 100)}%)` } }).catch(() => {});
        out.paused += 1;
        notes.push(`campaign "${b.name}" auto-paused — ${failed} failures`);
        await logApp("ERROR", "WHATSAPP", `campaign "${b.name}" auto-paused after ${failed} failed sends`, { broadcastId: b.id });
      } else if (allQueued && pending === 0) {
        await db.waBroadcast.update({ where: { id: b.id }, data: { status: "DONE", finishedAt: new Date() } }).catch(() => {});
        out.done += 1;
        notes.push(`campaign "${b.name}" finished — ${sent} sent, ${failed} failed, ${skippedRows} skipped`);
        await logApp("INFO", "WHATSAPP", `campaign "${b.name}" finished — ${sent} sent, ${failed} failed, ${skippedRows} skipped`, { broadcastId: b.id });
      } else if (allQueued && pending === 0 && sent === 0 && failed === 0) {
        await db.waBroadcast.update({ where: { id: b.id }, data: { status: "FAILED", finishedAt: new Date(), lastError: "Kono message pathano jay ni" } }).catch(() => {});
      }
    }
  } catch (e: any) {
    notes.push("broadcast advance failed: " + String(e?.message || e).slice(0, 120));
  }
  return out;
}

/* ── reporting ─────────────────────────────────────────────────────────────────────── */

export type BroadcastReport = {
  broadcast: any;
  counts: { queued: number; sending: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
  failedRows: { id: number; toWaId: string; error: string | null; attempts: number }[];
  clicks: { slug: string; target: string; clicks: number; lastClickAt: string | null } | null;
  attributed: { count: number; revenue: number; recent: { code: string; name: string; total: number; status: string; createdAt: string }[] };
  audience: { total: number; remaining: number; description: string; excluded: Record<string, number> };
};

export async function broadcastReport(id: number): Promise<BroadcastReport | null> {
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await db.waBroadcast.findUnique({ where: { id } });
  if (!b) return null;

  const rows = await db.waMessage.findMany({ where: { broadcastId: id }, select: { id: true, toWaId: true, status: true, error: true, attempts: true } });
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const failedRows = rows.filter((r) => r.status === "FAILED").slice(0, 50).map((r) => ({ id: r.id, toWaId: r.toWaId, error: r.error, attempts: r.attempts }));

  const link = b.linkSlug ? await db.waLink.findUnique({ where: { slug: b.linkSlug } }).catch(() => null) : null;

  // attributed orders: orders from campaign recipients, placed after the campaign started
  const recipients = parseJson<WaRecipient[]>(b.recipients, []);
  const phones = recipients.map((r) => r.phone).slice(0, 20000);
  const startedAt = b.startedAt || b.createdAt;
  let attributed = { count: 0, revenue: 0, recent: [] as BroadcastReport["attributed"]["recent"] };
  if (phones.length) {
    const orders = await db.order.findMany({
      where: { phone: { in: phones }, createdAt: { gte: startedAt }, status: { notIn: ["CANCELLED"] } },
      orderBy: { id: "desc" },
      take: 200,
      select: { code: true, name: true, total: true, status: true, createdAt: true, phone: true },
    }).catch(() => []);
    // only count a person once (their first order after the campaign)
    const seen = new Set<string>();
    const unique = orders.filter((o) => (seen.has(o.phone) ? false : (seen.add(o.phone), true)));
    attributed = {
      count: unique.length,
      revenue: unique.reduce((sum, o) => sum + (Number(o.total) || 0), 0),
      recent: unique.slice(0, 10).map((o) => ({ code: o.code, name: o.name, total: o.total, status: o.status, createdAt: o.createdAt.toISOString() })),
    };
  }

  return {
    broadcast: b,
    counts: {
      queued: count("QUEUED"), sending: count("SENDING"), sent: count("SENT"), delivered: count("DELIVERED"),
      read: count("READ"), failed: count("FAILED"), skipped: count("SKIPPED"),
    },
    failedRows,
    clicks: link ? { slug: link.slug, target: link.target, clicks: link.clicks, lastClickAt: link.lastClickAt ? link.lastClickAt.toISOString() : null } : null,
    attributed,
    audience: {
      total: b.total,
      remaining: Math.max(0, b.total - (b.enqueued || 0)),
      description: describeRule(audienceRule(b.audienceRule)),
      excluded: {} as Record<string, number>,
    },
  };
}

export function broadcastCsv(report: BroadcastReport & { rows?: any[] }): string {
  const head = "phone,status,attempts,error,queued_at,sent_at,delivered_at,read_at";
  const rows = (report.rows || []).map((r: any) => [
    r.toWaId, r.status, r.attempts,
    `"${String(r.error || "").replace(/"/g, '""')}"`,
    r.queuedAt ? new Date(r.queuedAt).toISOString() : "",
    r.sentAt ? new Date(r.sentAt).toISOString() : "",
    r.deliveredAt ? new Date(r.deliveredAt).toISOString() : "",
    r.readAt ? new Date(r.readAt).toISOString() : "",
  ].join(","));
  const summary = [
    `# campaign,${report.broadcast.name}`,
    `# status,${report.broadcast.status}`,
    `# audience,"${report.audience.description}"`,
    `# total,${report.broadcast.total}`,
    `# sent,${report.counts.sent + report.counts.delivered + report.counts.read}`,
    `# failed,${report.counts.failed}`,
    `# skipped,${report.counts.skipped}`,
    `# clicks,${report.clicks?.clicks ?? 0}`,
    `# attributed_orders,${report.attributed.count}`,
    `# attributed_revenue,${report.attributed.revenue}`,
  ];
  return [...summary, head, ...rows].join("\n");
}

/** The list view + the KPI strip on the hub screen. */
export async function broadcastList(take = 50) {
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});
  const rows: any[] = await db.waBroadcast.findMany({ orderBy: { id: "desc" }, take }).catch(() => []);
  const optOuts = await db.waOptOut.count().catch(() => 0);
  const active = rows.filter((r) => r.status === "RUNNING" || r.status === "SCHEDULED").length;
  const totals = rows.reduce(
    (acc, r) => {
      acc.sent += r.sent;
      acc.failed += r.failed;
      acc.skipped += r.skipped;
      acc.people += r.total;
      return acc;
    },
    { sent: 0, failed: 0, skipped: 0, people: 0 },
  );
  return { broadcasts: rows, kpi: { active, optOuts, ...totals } };
}
