import { getSettings } from "./settings";
import { db } from "./db";

/* Client for the local WhatsApp bridge (scripts/whatsapp-bridge.js, binds 127.0.0.1).
   The bridge runs Baileys (WhatsApp linked-device protocol) — status is always real.

   Multi-device: the bridge runs one session per phone (`.wa-auth/<sessionId>/`). Every call here
   can name a session; without one the bridge uses its default device (what the older screens —
   inbox, settings, admin alerts — keep doing). Nothing else in the app talks to WhatsApp. */
const FALLBACK = "http://127.0.0.1:3001";
/* The key the bridge expects. Settings win over env so the admin panel stays the single place a
   shop owner configures things — the bridge itself is started with the same value
   (`WA_BRIDGE_KEY=… npm run wa`); both sides falling back to "local-bridge" keeps a local
   machine working with no configuration at all. */
export async function bridgeKey(): Promise<string> {
  try {
    const s = await getSettings();
    const configured = (s as any).notifications?.waBridgeKey;
    if (configured) return String(configured);
  } catch {}
  if (process.env.WA_BRIDGE_KEY) return process.env.WA_BRIDGE_KEY;
  return process.env.NODE_ENV === "production" ? "" : "local-bridge";
}
export async function bridgeAuthorized(req: Request): Promise<boolean> {
  const sent = (req.headers.get("x-bridge-key") || "").trim();
  if (!sent) return false;
  const expected = await bridgeKey();
  if (!expected) return false;
  return sent === expected;
}
async function base(): Promise<string> {
  try {
    const s = await getSettings();
    return s.notifications?.waBridgeUrl || process.env.WA_BRIDGE_URL || FALLBACK;
  } catch { return FALLBACK; }
}
async function call(pathname: string, init?: RequestInit, timeoutMs = 30000): Promise<any> {
  try {
    const res = await fetch((await base()) + pathname, {
      ...init,
      headers: { "Content-Type": "application/json", "x-bridge-key": await bridgeKey(), ...(init?.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, data: {} }; // bridge not running
  }
}
function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? "?" + s : "";
}

/* The device the app uses when a caller does not name one: the owner's default (Settings →
   WhatsApp → Devices → "set default"), else the first connected number. Falls back to the
   bridge's own default when the table is empty. */
export async function waDefaultSession(): Promise<string | undefined> {
  try {
    const { ensureExtraTables } = await import("./db-ensure");
    await ensureExtraTables().catch(() => {});
    const byDefault = await db.waDevice.findFirst({ where: { isDefault: true, status: "CONNECTED" }, orderBy: { id: "asc" }, select: { sessionId: true } });
    if (byDefault?.sessionId) return byDefault.sessionId;
    const any = await db.waDevice.findFirst({ where: { status: "CONNECTED" }, orderBy: { id: "asc" }, select: { sessionId: true } });
    return any?.sessionId || undefined;
  } catch {
    return undefined;
  }
}

/* ── single (legacy) device: what the inbox / settings / admin alerts use ─────────────── */
export async function waStatus(): Promise<{ running: boolean; connected: boolean; me?: string | null; qrPending?: boolean }> {
  const r = await call("/status");
  return { running: r.status === 200, connected: !!r.data.connected, me: r.data.me || null, qrPending: !!r.data.qrPending };
}
export async function waGetQr(): Promise<{ connected: boolean; qr: string | null; hint?: string }> {
  const r = await call("/qr");
  return { connected: !!r.data.connected, qr: r.data.qr || null, hint: r.data.hint };
}
export async function waSend(to: string, message: string, sessionId?: string): Promise<{ ok: boolean; connected: boolean; error?: string; id?: string | null }> {
  const r = await call("/send", { method: "POST", body: JSON.stringify({ to, message, sessionId: sessionId || (await waDefaultSession()) }) });
  if (r.status === 0) return { ok: false, connected: false, error: "Bridge service cholche na (npm run wa)" };
  if (r.status === 503) return { ok: false, connected: false, error: r.data.error || "WhatsApp not connected" };
  return { ok: !!r.data.ok, connected: true, error: r.data.error, id: r.data.id || null };
}
export async function waLogout(sessionId?: string): Promise<{ ok: boolean }> {
  const r = await call("/logout", { method: "POST", body: JSON.stringify({ sessionId }) });
  return { ok: r.status === 200 };
}

/* ── multi-device ─────────────────────────────────────────────────────────────────────── */
export type BridgeDevice = {
  sessionId: string; name?: string | null; status: string; connected: boolean;
  me?: string | null; phone?: string | null; qrPending?: boolean;
};
export async function waDevices(): Promise<{ running: boolean; devices: BridgeDevice[]; error?: string }> {
  const r = await call("/devices", undefined, 10000);
  if (r.status !== 200) return { running: false, devices: [], error: r.status === 0 ? "Bridge service cholche na" : r.data.error };
  return { running: true, devices: Array.isArray(r.data.devices) ? r.data.devices : [] };
}
/** Boot a session (creates the auth folder and the pairing QR). */
export async function waDeviceBoot(sessionId: string, name?: string): Promise<{ ok: boolean; error?: string; status?: string }> {
  const r = await call("/devices", { method: "POST", body: JSON.stringify({ sessionId, name }) }, 20000);
  if (r.status === 0) return { ok: false, error: "Bridge service cholche na" };
  return { ok: r.status === 200 && r.data.ok !== false, error: r.data.error, status: r.data.status };
}
export async function waDeviceQr(sessionId: string): Promise<{ connected: boolean; qr: string | null; status?: string; hint?: string }> {
  const r = await call(`/devices/${encodeURIComponent(sessionId)}/qr`, undefined, 15000);
  return { connected: !!r.data.connected, qr: r.data.qr || null, status: r.data.status, hint: r.data.hint };
}
export async function waDeviceLogout(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(`/devices/${encodeURIComponent(sessionId)}/logout`, { method: "POST" });
  return { ok: r.status === 200, error: r.data.error };
}
/** Images + caption. Phase 1 sent one photo (the order confirmation); the panel can now attach up
    to 10 — the first one carries the caption, the rest ride along as a gallery. */
export async function waSendMedia(opts: { to: string; image?: string; images?: string[]; caption?: string; sessionId?: string }): Promise<{ ok: boolean; connected: boolean; error?: string; id?: string | null; ids?: string[]; sentImages?: number; failedImages?: number }> {
  const images = (opts.images && opts.images.length ? opts.images : opts.image ? [opts.image] : []).slice(0, 10);
  const r = await call("/send-media", { method: "POST", body: JSON.stringify({ ...opts, images }) }, 90000);
  if (r.status === 0) return { ok: false, connected: false, error: "Bridge service cholche na (npm run wa)" };
  if (r.status === 503) return { ok: false, connected: false, error: r.data.error || "WhatsApp not connected" };
  const ids: string[] = [];
  if (r.data.id) ids.push(r.data.id);
  if (Array.isArray(r.data.ids)) for (const id of r.data.ids) if (id) ids.push(id);
  return {
    ok: !!r.data.ok, connected: true, error: r.data.error,
    id: ids[0] || r.data.id || null, ids,
    sentImages: Number(r.data.sentImages ?? images.length) || 0,
    failedImages: Number(r.data.failedImages ?? 0) || 0,
  };
}
export async function waHealth(): Promise<{ running: boolean; uptimeSec?: number; sessions?: number; connected?: number }> {
  const r = await call("/health", undefined, 8000);
  return { running: r.status === 200, uptimeSec: r.data.uptimeSec, sessions: r.data.sessions, connected: r.data.connected };
}

/** Key scripts/wa-worker.js uses to call the tick endpoint (Settings → WhatsApp, or env). */
export async function waWorkerKey(): Promise<string> {
  try {
    const s = await getSettings();
    const k = (s as any).whatsapp?.workerKey;
    if (k) return String(k);
  } catch {}
  return process.env.WA_WORKER_KEY || (await bridgeKey());
}
/** True when the request carries the worker key (or the bridge key — same trust level). */
export async function waWorkerAuthorized(req: Request): Promise<boolean> {
  const sent = (req.headers.get("x-wa-worker-key") || "").trim();
  if (!sent) return false;
  const expected = await waWorkerKey();
  const bridge = await bridgeKey();
  if (expected && sent === expected) return true;
  if (bridge && sent === bridge) return true;
  return false;
}
