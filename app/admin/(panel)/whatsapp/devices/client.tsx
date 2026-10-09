"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useRef, useState } from "react";

/* Device cards + pairing modal.
   While a QR is on screen we poll the bridge every 3 s: the moment the owner scans it, the card
   flips to CONNECTED without anyone pressing refresh. */
type Live = { connected: boolean; me: string | null; qrPending: boolean; status: string } | null;
type Device = {
  id: number; name: string; sessionId: string; phone: string | null; status: string; isDefault: boolean;
  dailyCap: number; sentToday: number; sentTodayReal: number; warmupStage: number; consecutiveFailures: number;
  lastSeenAt: string | null; lastError: string | null; live: Live;
};
type Data = { bridgeRunning: boolean; devices: Device[]; unknownSessions: { sessionId: string; status: string; phone: string | null }[] };

const WARMUP_LABEL = ["1st week (new)", "2nd week", "3rd week", "mature"];
const pretty = (p: string | null) => (p ? String(p).replace(/^880/, "0").replace(/\D/g, "") : "—");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

export default function WaDevices() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [qr, setQr] = useState<{ id: number; name: string; data: string | null; hint?: string; connected: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [capEdit, setCapEdit] = useState<Record<number, { cap: number; stage: number }>>({});
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    const r = await afetch("/api/admin/whatsapp/devices");
    const j = await r.json().catch(() => ({}));
    if (r.ok) setD(j);
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  const act = async (body: any, label: string) => {
    setBusy(label); setMsg(null);
    const r = await afetch("/api/admin/whatsapp/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok || j.ok === false) setMsg({ text: j.error || "Failed", ok: false });
    else if (body.action === "add") setMsg({ text: `${body.name} add hoyeche — QR scan korun`, ok: true });
    else setMsg({ text: "Done ✓", ok: true });
    await load();
    return j;
  };

  const openQr = async (device: Device) => {
    setQr({ id: device.id, name: device.name, data: null, connected: false, hint: "QR make hocche…" });
    const j = await act({ action: "qr", id: device.id }, "qr" + device.id);
    setQr((cur) => (cur && cur.id === device.id ? { ...cur, data: j.qr || null, connected: !!j.connected, hint: j.hint || j.bridge?.error } : cur));
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const r = await afetch("/api/admin/whatsapp/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "qr", id: device.id }) });
      const j = await r.json().catch(() => ({}));
      setQr((cur) => {
        if (!cur || cur.id !== device.id) return cur;
        if (j.connected) { if (poll.current) clearInterval(poll.current); load(); return { ...cur, connected: true, data: null }; }
        return { ...cur, data: j.qr || cur.data, hint: j.hint || cur.hint };
      });
    }, 3000);
  };
  const closeQr = () => { if (poll.current) clearInterval(poll.current); poll.current = null; setQr(null); load(); };
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  if (!d) return <div className="acard"><div className="acard-b">Loading…</div></div>;

  return (
    <>
      {!d.bridgeRunning && (
        <div className="noti err" style={{ marginBottom: 16 }}>
          Bridge cholche na — device add korleo session start hobe na. Server-e <code>npm run wa</code> (ba
          <code> pm2 start scripts/whatsapp-bridge.js --name sinzo-wa-bridge</code>) chalu korun.
        </div>
      )}
      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 14 }}>{msg.text}</div>}

      <div className="acard" style={{ marginBottom: 16 }}>
        <div className="acard-h"><h3>Numbers</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{d.devices.filter((x) => x.status === "CONNECTED").length} connected of {d.devices.length}</span></div>
        <div className="acard-b" style={{ display: "grid", gap: 14 }}>
          {d.devices.length === 0 && <div style={{ color: "var(--muted)" }}>Ekhono kono number nei — niche add korun.</div>}
          {d.devices.map((x) => {
            const edit = capEdit[x.id] || { cap: x.dailyCap, stage: x.warmupStage };
            const used = x.sentTodayReal || x.sentToday;
            const pct = Math.min(100, Math.round((used / Math.max(1, x.dailyCap)) * 100));
            return (
              <div key={x.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {renameId === x.id ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <input value={renameText} onChange={(e) => setRenameText(e.target.value)} style={{ padding: "4px 8px" }} />
                          <button className="abtn sm primary" onClick={async () => { await act({ action: "rename", id: x.id, name: renameText }, "r" + x.id); setRenameId(null); }}>Save</button>
                          <button className="abtn sm" onClick={() => setRenameId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <>
                          {x.name}
                          {x.isDefault && <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: 6 }}>· DEFAULT</span>}
                          <button className="abtn sm" style={{ marginLeft: 8 }} onClick={() => { setRenameId(x.id); setRenameText(x.name); }}>Rename</button>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {x.phone ? pretty(x.phone) : "not paired yet"} · session <code>{x.sessionId}</code> · last seen {when(x.lastSeenAt)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={"pill " + (x.status === "CONNECTED" ? "DELIVERED" : x.status === "PAUSED" ? "ON_HOLD" : x.status === "QR" ? "PENDING" : "FAILED")}>{x.status}</span>
                    {x.status !== "CONNECTED" && <button className="abtn sm primary" disabled={busy === "qr" + x.id} onClick={() => openQr(x)}>Pair / QR</button>}
                    {x.status === "CONNECTED" && <button className="abtn sm" onClick={() => openQr(x)}>Session</button>}
                    {!x.isDefault && <button className="abtn sm" onClick={() => act({ action: "default", id: x.id }, "d" + x.id)}>Set default</button>}
                    {x.status === "PAUSED"
                      ? <button className="abtn sm" onClick={() => act({ action: "resume", id: x.id }, "p" + x.id)}>Resume</button>
                      : <button className="abtn sm" onClick={() => act({ action: "pause", id: x.id }, "p" + x.id)}>Pause</button>}
                    <button className="abtn sm" onClick={() => { if (confirm(`${x.name} unlink korbe? Abar QR scan korte hobe.`)) act({ action: "logout", id: x.id }, "l" + x.id); }}>Unlink</button>
                    <button className="abtn sm" onClick={() => { if (confirm(`${x.name} ekdom delete korbe?`)) act({ action: "remove", id: x.id }, "rm" + x.id); }}>Delete</button>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    <span>Today: <b style={{ color: used >= x.dailyCap ? "var(--danger)" : "var(--fg)" }}>{used}</b> / {x.dailyCap}</span>
                    <span>warm-up: {WARMUP_LABEL[x.warmupStage] || "new"}{x.consecutiveFailures ? ` · ${x.consecutiveFailures} fail in a row` : ""}</span>
                  </div>
                  <div style={{ height: 8, background: "var(--line)", borderRadius: 999 }}>
                    <div style={{ height: 8, width: pct + "%", background: used >= x.dailyCap ? "var(--danger)" : "var(--accent)", borderRadius: 999 }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                  <div className="af" style={{ width: 150 }}><label>Daily cap</label>
                    <input type="number" min={1} value={edit.cap} onChange={(e) => setCapEdit({ ...capEdit, [x.id]: { ...edit, cap: Number(e.target.value) } })} />
                  </div>
                  <div className="af" style={{ width: 190 }}><label>Warm-up stage</label>
                    <select value={edit.stage} onChange={(e) => {
                      const stage = Number(e.target.value);
                      setCapEdit({ ...capEdit, [x.id]: { cap: [50, 150, 300, 400][stage], stage } });
                    }}>
                      {WARMUP_LABEL.map((l, i) => <option key={l} value={i}>{l} — {[50, 150, 300, 400][i]}/day</option>)}
                    </select>
                  </div>
                  <button className="abtn sm primary" disabled={busy === "c" + x.id} onClick={() => act({ action: "cap", id: x.id, dailyCap: edit.cap, warmupStage: edit.stage }, "c" + x.id)}>Save cap</button>
                  <span style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 380 }}>
                    Notun number-e din-e 50-er beshi pathaben na — WhatsApp &ldquo;cold&rdquo; number ke bulk hishebe dekhe block korte pare.
                  </span>
                </div>

                {x.lastError && <div style={{ fontSize: 11.5, color: "var(--danger)" }}>last error: {x.lastError}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="acard">
        <div className="acard-h"><h3>Add a number</h3></div>
        <div className="acard-b" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div className="af" style={{ minWidth: 240, flex: 1 }}><label>Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="TRENDING'S Support / TRENDING'S Offers" />
          </div>
          <button className="abtn primary" disabled={!newName.trim() || busy === "add"} onClick={async () => { await act({ action: "add", name: newName.trim() }, "add"); setNewName(""); }}>
            {busy === "add" ? "…" : "Add device"}
          </button>
        </div>
        <div className="acard-b" style={{ borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--muted)" }}>
          Add korar por <b>Pair / QR</b> e click korun, phone theke WhatsApp → Linked devices → Link a device diye scan korun.
          {d.unknownSessions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              Bridge-e {d.unknownSessions.length} ta session ache jeta panel-e nei: {d.unknownSessions.map((u) => u.sessionId).join(", ")} — upor theke add korle ekhane chole ashbe.
            </div>
          )}
        </div>
      </div>

      {qr && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,15,15,.55)", display: "grid", placeItems: "center", zIndex: 60 }} onClick={closeQr}>
          <div className="acard" style={{ width: 380, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="acard-h"><h3>{qr.name}</h3><button className="abtn sm" onClick={closeQr}>Close</button></div>
            <div className="acard-b" style={{ textAlign: "center" }}>
              {qr.connected ? (
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ok)" }}>Connected ✓</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Ei number ekhon message pathate parbe.</div>
                </div>
              ) : qr.data ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.data} alt="WhatsApp pairing QR" style={{ width: 260, height: 260, imageRendering: "pixelated" }} />
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
                    WhatsApp → <b>Linked devices</b> → <b>Link a device</b> → ei QR scan korun. QR ~30 sec e expire hoy, expire hole notun ta nijei chole ashe.
                  </div>
                </>
              ) : (
                <div style={{ padding: "30px 0", color: "var(--muted)" }}>
                  {qr.hint || "QR er jonno wait korun…"}
                  <div style={{ marginTop: 10, fontSize: 12 }}>Bridge bondho thakle QR asbe na.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
