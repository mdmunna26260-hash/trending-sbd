/* WhatsApp Linked-Device Bridge (Baileys / multi-device protocol)
   ------------------------------------------------------------------
   A SEPARATE local service (binds 127.0.0.1 only — never exposed to the internet). It is the only
   process that talks to WhatsApp:

     • one session per phone number, keys on disk in  .wa-auth/<sessionId>/  (never in the DB)
     • the admin panel shows the pairing QR; scan once → the session survives restarts
     • inbound customer messages are forwarded to the store (/api/wa/inbound)
     • delivery / read receipts are forwarded to the store (/api/wa/receipt)
     • device state changes are forwarded to the store (/api/wa/device)

   Run it on the VPS:   pm2 start scripts/whatsapp-bridge.js --name sinzo-wa-bridge
   Or locally:          npm run wa            (dev server must be on WA_APP_URL)

   HTTP API (all require the x-bridge-key header — the app sends Settings → Notifications →
   "Bridge key", falling back to WA_BRIDGE_KEY / "local-bridge"):
     GET  /status                        legacy: default device
     GET  /qr                            legacy: default device QR (data URL)
     POST /send        {to,message,sessionId?}
     POST /send-media  {to,image|caption|images[],sessionId?}   (up to 10 images)
     GET  /devices                       every session + state
     POST /devices     {sessionId,name}  boot a session (QR appears)
     GET  /devices/:id/qr
     POST /devices/:id/logout            unlink + wipe the session folder
     POST /logout      {sessionId?}      legacy alias of the above
     GET  /health                        for the worker / monitors
*/
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");
const http = require("http");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const PORT = Number(process.env.WA_BRIDGE_PORT || 3001);
const KEY = process.env.WA_BRIDGE_KEY || "local-bridge";
/* Where inbound customer messages / receipts are forwarded: the store's own webhooks. */
const APP_URL = (process.env.WA_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
/* A hard floor between two outgoing messages on the same number (the worker paces the rest). */
const SEND_GAP_MS = Number(process.env.WA_SEND_GAP_MS || 3000);
const AUTH_ROOT = process.env.WA_AUTH_DIR || path.join(__dirname, "..", ".wa-auth");
const LEGACY_DIR = path.join(__dirname, "..", "wa-session");

const startedAt = Date.now();
/** sessionId → { id, name, sock, qr, connected, me, started, starting, want, lastSendAt, lastError, banned } */
const sessions = new Map();

function log(...a) { console.log(`[wa ${new Date().toISOString().slice(11, 19)}]`, ...a); }

function authDir(id) { return path.join(AUTH_ROOT, id); }
function safeId(id) { return String(id || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40); }

async function notifyApp(pathname, payload) {
  try {
    await fetch(APP_URL + pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-key": KEY },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    log("app webhook failed:", pathname, e?.message || e);
  }
}

function stateOf(s) {
  if (!s) return "DISCONNECTED";
  if (s.banned) return "BANNED";
  if (s.connected) return "CONNECTED";
  if (s.qr) return "QR";
  return "DISCONNECTED";
}

function list() {
  return [...sessions.values()].map((s) => ({
    sessionId: s.id,
    name: s.name,
    status: stateOf(s),
    connected: !!s.connected,
    me: s.me?.id || s.me || null,
    phone: String(s.me?.id || "").replace(/\D/g, "").replace(/:\d+$/, "") || null,
    qrPending: !!s.qr,
    lastError: s.lastError || null,
  }));
}

function defaultSession() {
  const wanted = process.env.WA_SESSION_ID ? sessions.get(safeId(process.env.WA_SESSION_ID)) : null;
  if (wanted) return wanted;
  const connected = [...sessions.values()].find((s) => s.connected);
  if (connected) return connected;
  return [...sessions.values()][0] || null;
}

/* ── sessions ─────────────────────────────────────────────────────────────────────────── */
async function startSession(id, name) {
  const sid = safeId(id);
  if (!sid) return null;
  let s = sessions.get(sid);
  if (s && s.starting) return s;
  if (!s) {
    s = { id: sid, name: name || sid, sock: null, qr: null, connected: false, me: null, starting: false, want: true, lastSendAt: 0, lastError: null, banned: false };
    sessions.set(sid, s);
  }
  if (s.want === false) return s;
  s.starting = true;
  try {
    fs.mkdirSync(authDir(sid), { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir(sid));
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: ["TRENDING'S Commerce", "Chrome", "1.0"],
      markOnlineOnConnect: false,
    });
    s.sock = sock;

    /* inbound customer messages → store inbox */
    sock.ev.on("messages.upsert", async (ev) => {
      try {
        if (ev.type !== "notify") return;
        for (const m of ev.messages || []) {
          const jid = m.key?.remoteJid || "";
          if (!jid.endsWith("@s.whatsapp.net") || m.key?.fromMe) continue;
          const msg = m.message || {};
          const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            msg.imageMessage?.caption ||
            msg.videoMessage?.caption ||
            (msg.imageMessage ? "[image]" : msg.videoMessage ? "[video]" : msg.documentMessage ? "[document]" : msg.audioMessage ? "[voice note]" : "");
          if (!text) continue;
          await notifyApp("/api/wa/inbound", {
            waId: jid.split("@")[0],
            name: m.pushName || null,
            body: String(text).slice(0, 4000),
            at: Number(m.messageTimestamp || 0) || null,
            sessionId: sid,
          });
        }
      } catch (e) { log("inbound handler error:", e?.message || e); }
    });

    /* delivery / read receipts → the queue rows */
    sock.ev.on("messages.update", async (updates) => {
      try {
        for (const u of updates || []) {
          const id = u.key?.id;
          const st = u.update?.status;
          if (!id || st === undefined || st === null) continue;
          const mapped = st >= 4 ? "READ" : st === 3 ? "DELIVERED" : null;
          if (!mapped) continue;
          await notifyApp("/api/wa/receipt", { id, status: mapped, sessionId: sid });
        }
      } catch (e) { log("receipt handler error:", e?.message || e); }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        s.qr = qr;
        s.connected = false;
        log(`${sid}: QR ready — scan from WhatsApp → Linked devices`);
        notifyApp("/api/wa/device", { sessionId: sid, name: s.name, status: "QR" });
      }
      if (connection === "open") {
        s.connected = true; s.qr = null; s.me = sock.user || null; s.lastError = null; s.banned = false;
        const phone = String(sock.user?.id || "").replace(/\D/g, "").replace(/:\d+$/, "");
        log(`${sid}: connected as ${phone || sock.user?.id || "?"}`);
        notifyApp("/api/wa/device", { sessionId: sid, name: s.name, status: "CONNECTED", me: sock.user?.id || null, phone });
      }
      if (connection === "close") {
        s.connected = false; s.me = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        const errText = String(lastDisconnect?.error?.message || "");
        if (code === DisconnectReason.loggedOut) {
          s.banned = false;
          s.lastError = "logged out (unpaired)";
          try { fs.rmSync(authDir(sid), { recursive: true, force: true }); } catch {}
          log(`${sid}: logged out — session removed (pair again to reconnect)`);
          notifyApp("/api/wa/device", { sessionId: sid, name: s.name, status: "DISCONNECTED", error: s.lastError });
          s.starting = false;
          if (s.want) setTimeout(() => startSession(sid, s.name), 3000);
          return;
        }
        if (code === 403 || /forbidden|banned/i.test(errText)) {
          s.banned = true; s.lastError = "blocked by WhatsApp (403)";
          log(`${sid}: WhatsApp refused this number (403) — do NOT keep retrying in a loop`);
          notifyApp("/api/wa/device", { sessionId: sid, name: s.name, status: "BANNED", error: s.lastError });
          s.starting = false;
          return;
        }
        s.lastError = errText || `connection closed (${code})`;
        const retry = Math.min(60000, 3000 + Math.floor(Math.random() * 4000));
        log(`${sid}: connection closed (${code || "?"}) — reconnecting in ${Math.round(retry / 1000)}s`);
        notifyApp("/api/wa/device", { sessionId: sid, name: s.name, status: "DISCONNECTED", error: s.lastError });
        s.starting = false;
        if (s.want) setTimeout(() => startSession(sid, s.name), retry);
        return;
      }
    });
  } catch (e) {
    s.lastError = String(e?.message || e);
    log(`${sid}: start error:`, s.lastError);
  }
  s.starting = false;
  return s;
}

async function stopSession(s) {
  s.want = false;
  try { await s.sock?.logout(); } catch { try { s.sock?.end(undefined); } catch {} }
  try { fs.rmSync(authDir(s.id), { recursive: true, force: true }); } catch {}
  s.connected = false; s.qr = null; s.me = null;
}

function jidFor(number) {
  let digits = String(number || "").replace(/[^0-9]/g, "");
  // BD JIDs need the 880 country code without the leading zero:
  // 01676450711 → 8801676450711@s.whatsapp.net
  if (digits.startsWith("01")) digits = "880" + digits.slice(1);
  else if (digits.startsWith("880")) digits = digits;
  else if (digits.length === 10) digits = "880" + digits;
  return digits + "@s.whatsapp.net";
}

async function pace(session) {
  const wait = SEND_GAP_MS - (Date.now() - session.lastSendAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  session.lastSendAt = Date.now();
}

async function loadImage(src) {
  const s = String(src || "").trim();
  if (!s) throw new Error("empty image");
  if (s.startsWith("data:")) {
    const b64 = s.split(",")[1] || "";
    return Buffer.from(b64, "base64");
  }
  // A URL that points back at this machine can be read from disk (public/) instead of a round trip;
  // anything else is fetched over HTTP. Both paths end in a Buffer for Baileys.
  const localCandidate = s.startsWith("/") ? path.join(__dirname, "..", "public", s) : path.join(__dirname, "..", s);
  if (!/^https?:\/\//i.test(s) && fs.existsSync(localCandidate)) return fs.readFileSync(localCandidate);
  if (/^https?:\/\//i.test(s)) {
    try {
      const res = await fetch(s, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      throw new Error(`image fetch ${res.status}`);
    } catch (e) {
      // last resort: the same URL as a file path (covers http://127.0.0.1:3000/uploads/…)
      const m = /^https?:\/\/[^/]+(\/.*)$/.exec(s);
      if (m) {
        const p2 = path.join(__dirname, "..", "public", m[1]);
        if (fs.existsSync(p2)) return fs.readFileSync(p2);
      }
      throw e;
    }
  }
  return fs.readFileSync(s.startsWith("/") ? s : path.join(__dirname, "..", s));
}

async function sendText(session, to, text) {
  if (!session || !session.connected || !session.sock) {
    return { ok: false, code: 503, error: `session ${session?.id || "?"} is not connected` };
  }
  await pace(session);
  const jid = jidFor(to);
  const r = await session.sock.sendMessage(jid, { text: clampText(text) });
  return { ok: true, id: r?.key?.id || null, to: jid };
}

/* WhatsApp counts characters, JS counts UTF-16 units — Bengali and emoji live outside the BMP, so a
   plain slice() can cut a character in half. Never split a surrogate pair. */
function clampText(input, max = 4000) {
  const s = String(input == null ? "" : input);
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const nl = cut.lastIndexOf("\n");
  if (nl > max * 0.6) cut = cut.slice(0, nl);
  return cut.trimEnd() + "…";
}

/* One or many images. The FIRST image carries the caption (that is how a WhatsApp gallery reads:
   photo + text, then the rest as a swipe-through set); a single broken image must never swallow the
   message — it falls back to text, and if every image fails the text still goes. */
async function sendMedia(session, to, images, caption) {
  if (!session || !session.connected || !session.sock) {
    return { ok: false, code: 503, error: `session ${session?.id || "?"} is not connected` };
  }
  const list = (Array.isArray(images) ? images : images ? [images] : []).filter(Boolean).slice(0, 10);
  const text = clampText(caption || "");
  await pace(session);
  const jid = jidFor(to);
  if (!list.length) {
    const r = await session.sock.sendMessage(jid, { text });
    return { ok: true, id: r?.key?.id || null, ids: [], to: jid, sentImages: 0, failedImages: 0 };
  }

  const ids = [];
  let sent = 0;
  let failed = 0;
  const notes = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const buf = await loadImage(list[i]);
      if (i > 0) await pace(session);
      const r = await session.sock.sendMessage(jid, { image: buf, caption: i === 0 ? text : "" });
      ids.push(r?.key?.id || null);
      sent++;
    } catch (e) {
      failed++;
      notes.push(`image ${i + 1} skipped (${e?.message || "load failed"})`);
    }
  }
  if (!sent) {
    // nothing could be attached — the customer still gets the words
    const r = await session.sock.sendMessage(jid, { text });
    return { ok: true, id: r?.key?.id || null, ids: [], to: jid, sentImages: 0, failedImages: failed, note: notes.join("; ") };
  }
  return { ok: true, id: ids[0] || null, ids, to: jid, sentImages: sent, failedImages: failed, note: notes.join("; ") || undefined };
}

/* ── HTTP ─────────────────────────────────────────────────────────────────────────────── */
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url || "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  const done = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  if ((req.headers["x-bridge-key"] || "") !== KEY) return done(401, { error: "bad bridge key" });

  try {
    if (url.pathname === "/health") {
      return done(200, { ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), sessions: sessions.size, connected: [...sessions.values()].filter((s) => s.connected).length });
    }
    if (url.pathname === "/devices" && req.method === "GET") {
      return done(200, { ok: true, devices: list() });
    }
    if (url.pathname === "/devices" && req.method === "POST") {
      const b = await readBody(req);
      const id = safeId(b.sessionId);
      if (!id) return done(400, { error: "sessionId required" });
      const s = await startSession(id, b.name);
      return done(200, { ok: true, sessionId: id, status: stateOf(s), devices: list() });
    }
    if (parts[0] === "devices" && parts[1] && parts[2] === "qr" && req.method === "GET") {
      const s = sessions.get(safeId(parts[1]));
      if (!s) {
        const created = await startSession(parts[1], parts[1]);
        if (!created) return done(404, { error: "unknown session" });
        await new Promise((r) => setTimeout(r, 1200));
      }
      const cur = sessions.get(safeId(parts[1]));
      if (cur.connected) return done(200, { connected: true, qr: null, status: "CONNECTED", me: cur.me?.id || null });
      if (!cur.qr) return done(200, { connected: false, qr: null, status: stateOf(cur), hint: "waiting for QR from WhatsApp servers…" });
      const dataUrl = await qrcode.toDataURL(cur.qr, { margin: 1, width: 320 });
      return done(200, { connected: false, qr: dataUrl, status: "QR" });
    }
    if (parts[0] === "devices" && parts[1] && parts[2] === "logout" && req.method === "POST") {
      const s = sessions.get(safeId(parts[1]));
      if (!s) return done(404, { error: "unknown session" });
      await stopSession(s);
      await notifyApp("/api/wa/device", { sessionId: s.id, name: s.name, status: "DISCONNECTED", error: "unpaired" });
      s.want = true; s.starting = false;
      setTimeout(() => startSession(s.id, s.name), 1500); // ready for a fresh pairing
      return done(200, { ok: true, hint: "unpaired — a new QR will appear" });
    }
    if (url.pathname === "/status") {
      const s = defaultSession();
      return done(200, { running: true, connected: !!s?.connected, me: s?.me?.id || null, name: s?.me?.name || null, qrPending: !!s?.qr, sessionId: s?.id || null, devices: list().length });
    }
    if (url.pathname === "/qr") {
      const s = defaultSession();
      if (!s) return done(200, { connected: false, qr: null, hint: "no device registered — Devices page → add a number" });
      if (s.connected) return done(200, { connected: true, qr: null });
      if (!s.qr) return done(200, { connected: false, qr: null, hint: "waiting for QR from WhatsApp servers…" });
      const dataUrl = await qrcode.toDataURL(s.qr, { margin: 1, width: 320 });
      return done(200, { connected: false, qr: dataUrl });
    }
    if (url.pathname === "/send" && req.method === "POST") {
      const b = await readBody(req);
      const session = (b.sessionId && sessions.get(safeId(b.sessionId))) || defaultSession();
      if (!b.to || !b.message) return done(400, { error: "to & message required" });
      const r = await sendText(session, b.to, b.message);
      return r.ok ? done(200, r) : done(r.code || 502, r);
    }
    if (url.pathname === "/send-media" && req.method === "POST") {
      const b = await readBody(req);
      const session = (b.sessionId && sessions.get(safeId(b.sessionId))) || defaultSession();
      const images = Array.isArray(b.images) && b.images.length ? b.images : b.image ? [b.image] : [];
      if (!b.to || !images.length) return done(400, { error: "to & image(s) required" });
      const r = await sendMedia(session, b.to, images, b.caption);
      return r.ok ? done(200, r) : done(r.code || 502, r);
    }
    if (url.pathname === "/logout" && req.method === "POST") {
      const b = await readBody(req);
      const session = (b.sessionId && sessions.get(safeId(b.sessionId))) || defaultSession();
      if (!session) return done(404, { error: "no device" });
      await stopSession(session);
      session.want = true; session.starting = false;
      setTimeout(() => startSession(session.id, session.name), 1500);
      return done(200, { ok: true, hint: "unpaired — new QR will appear" });
    }
    return done(404, { error: "not found" });
  } catch (e) {
    return done(500, { error: String(e?.message || e).slice(0, 300) });
  }
});

async function boot() {
  fs.mkdirSync(AUTH_ROOT, { recursive: true });
  /* continuity: a machine that already paired with the old single-session bridge keeps working —
     the old ./wa-session folder is adopted as the "default" device. */
  try {
    const legacyHasCreds = fs.existsSync(path.join(LEGACY_DIR, "creds.json"));
    const rootEmpty = fs.readdirSync(AUTH_ROOT).filter((f) => !f.startsWith(".")).length === 0;
    if (legacyHasCreds && rootEmpty) {
      fs.renameSync(LEGACY_DIR, path.join(AUTH_ROOT, "default"));
      log("adopted the existing ./wa-session as device 'default'");
    }
  } catch (e) { log("legacy session adoption skipped:", e?.message || e); }

  const dirs = fs.readdirSync(AUTH_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const id of dirs) {
    log(`booting session ${id}…`);
    startSession(id, id);
  }
  if (!dirs.length) log("no sessions yet — add a number in Admin → WhatsApp → Devices");
}

server.listen(PORT, "127.0.0.1", () => {
  log(`bridge listening on 127.0.0.1:${PORT} (private) · app=${APP_URL} · auth=${AUTH_ROOT}`);
});
boot();

process.on("SIGTERM", () => { log("SIGTERM — closing"); try { for (const s of sessions.values()) s.sock?.end(undefined); } catch {} process.exit(0); });
process.on("SIGINT", () => { log("SIGINT — closing"); try { for (const s of sessions.values()) s.sock?.end(undefined); } catch {} process.exit(0); });
