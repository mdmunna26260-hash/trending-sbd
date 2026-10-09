"use client";
import { afetch } from "@/lib/afetch";
import { FEATURES } from "@/lib/features";
import { useState } from "react";

type Login = { action: string; at: string; ip: string; email: string };

const LOGIN_LABEL: Record<string, string> = {
  LOGIN: "Signed in", LOGIN_2FA: "Signed in (2FA)", LOGIN_2FA_RECOVERY: "Signed in (recovery code)",
  LOGIN_FAILED: "Failed sign-in", LOGIN_2FA_FAILED: "Failed 2FA code", LOGOUT_ALL: "Logged out everywhere",
  "2FA_ENABLED": "2FA switched on", "2FA_DISABLED": "2FA switched off",
};

export default function SecurityClient({ initial, logins }: { initial: { enabled: boolean; recoveryCodesLeft: number; sessionVersion: number }; logins: Login[] }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [setup, setSetup] = useState<{ secret: string; qr: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [version, setVersion] = useState(initial.sessionVersion);

  const post = async (action: string, extra: any = {}) => {
    setBusy(action); setMsg(null);
    const r = await afetch("/api/admin/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    return { ok: r.ok && j.ok, j };
  };

  const start = async () => {
    const { ok, j } = await post("setup");
    if (!ok) { setMsg({ text: j.error || "Setup failed", ok: false }); return; }
    setSetup({ secret: j.secret, qr: j.qr, otpauth: j.otpauth });
    setCode(""); setCodes(null);
  };

  const enable = async () => {
    if (!setup) return;
    const { ok, j } = await post("enable", { secret: setup.secret, code });
    if (!ok) { setMsg({ text: j.error || "Could not verify that code", ok: false }); return; }
    setEnabled(true); setCodes(j.codes || []); setSetup(null); setCode("");
    setMsg({ text: j.message, ok: true });
  };

  const disable = async () => {
    if (!code) { setMsg({ text: "Disable korte current authenticator code din.", ok: false }); return; }
    const { ok, j } = await post("disable", { code });
    if (!ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    setEnabled(false); setCodes(null); setCode("");
    setMsg({ text: j.message, ok: true });
  };

  const regen = async () => {
    if (!code) { setMsg({ text: "Recovery code banate current authenticator code din.", ok: false }); return; }
    const { ok, j } = await post("recovery", { code });
    if (!ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    setCodes(j.codes || []); setCode("");
    setMsg({ text: j.message, ok: true });
  };

  const logoutAll = async () => {
    if (!confirm("Sob device theke logout hoye jabe (phone + onno browser). Ei browser active thakbe. Continue?")) return;
    const { ok, j } = await post("logout_all");
    if (!ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    if (j.token) {
      document.cookie = `sz_session_fb=${j.token}; path=/; max-age=604800; SameSite=Lax`;
      try { localStorage.setItem("sz_admin_token", j.token); } catch {}
    }
    setVersion(j.sessionVersion);
    setMsg({ text: j.message, ok: true });
  };

  const copy = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); setMsg({ text: "Copied ✓", ok: true }); };

  return (
    <>
      {/* 2FA card (lib/features.ts → adminTwoFactor) na thakle Sessions ek column-i thake */}
      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: `repeat(${FEATURES.adminTwoFactor ? 2 : 1}, 1fr)`, gap: 16, alignItems: "start"  }}>
{/* 2FA hidden (lib/features.ts) — switch on korlei card ta ferot ashe */}
{FEATURES.adminTwoFactor && (<>
          <div className="acard">
            <div className="acard-h">
              <h3>Two-factor authentication</h3>
              <span className={"risk-badge " + (enabled ? "risk-LOW" : "risk-HIGH")}>{enabled ? "ON" : "OFF"}</span>
            </div>
            <div className="acard-b">
              {!enabled && !setup && (
                <>
                  <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 0 }}>
                    Password chara-o keu dhukte na parle valo. Authenticator app (Google Authenticator, Authy, 1Password)
                    diye 30 second-er ekta code — eta on korle password leak holeo keu vitore dhukte parbe na.
                  </p>
                  <button className="abtn primary" onClick={start} disabled={busy === "setup"}>{busy === "setup" ? "…" : "Set up 2FA"}</button>
                </>
              )}

              {setup && (
                <>
                  <p style={{ fontSize: 13.5, marginTop: 0 }}>
                    Authenticator app kholun → <b>Add account</b> → QR scan korun (ba nicher key ta type korun).
                  </p>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <img src={setup.qr} alt="2FA QR" width={160} height={160} style={{ border: "1px solid var(--line)", borderRadius: 8 }} />
                    <div style={{ fontSize: 12.5 }}>
                      <div style={{ color: "var(--muted)" }}>Manual key</div>
                      <code style={{ fontSize: 13, letterSpacing: "1px" }}>{setup.secret}</code>
                      <div style={{ marginTop: 6 }}><button className="abtn sm" onClick={() => copy(setup.secret)}>Copy key</button></div>
                    </div>
                  </div>
                  <div className="af" style={{ marginTop: 14, maxWidth: 260 }}>
                    <label>App er current 6-digit code</label>
                    <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456"
                      style={{ letterSpacing: ".3em", fontSize: 20, textAlign: "center", fontFamily: "ui-monospace, monospace" }} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="abtn primary" onClick={enable} disabled={busy === "enable" || code.replace(/\D/g, "").length < 6}>{busy === "enable" ? "…" : "Verify & turn on"}</button>
                    <button className="abtn" onClick={() => { setSetup(null); setCode(""); }}>Cancel</button>
                  </div>
                </>
              )}

              {enabled && (
                <>
                  <div className="noti ok" style={{ marginBottom: 12 }}>2FA চালু আছে — sign in korle authenticator code lagbe.</div>
                  <div className="af" style={{ maxWidth: 260 }}>
                    <label>Authenticator code (change korte)</label>
                    <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456"
                      style={{ letterSpacing: ".3em", fontSize: 20, textAlign: "center", fontFamily: "ui-monospace, monospace" }} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="abtn" onClick={regen} disabled={busy === "recovery"}>{busy === "recovery" ? "…" : "New recovery codes"}</button>
                    <button className="abtn" onClick={disable} disabled={busy === "disable"}>{busy === "disable" ? "…" : "Turn off 2FA"}</button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{initial.recoveryCodesLeft} recovery code baki (use hole komte thake).</div>
                </>
              )}

              {codes && (
                <div style={{ marginTop: 14, border: "1px dashed var(--ok)", borderRadius: 8, padding: 12 }}>
                  <b style={{ fontSize: 13 }}>Recovery codes — ekhon save korun (ar dekhano hobe na)</b>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                    {codes.map((c) => <div key={c}>{c}</div>)}
                  </div>
                  <button className="abtn sm" style={{ marginTop: 10 }} onClick={() => copy(codes.join("\n"))}>Copy all</button>
                </div>
              )}

              {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginTop: 12 }}>{msg.text}</div>}
            </div>
          </div>
</>)}
        <div className="acard">
          <div className="acard-h"><h3>Sessions</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>session version {version}</span></div>
          <div className="acard-b">
            <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 0 }}>
              Phone hariye gele, ba kono device-e login rakha thakle — ei button ta sob purono session
              invalid kore dey (token hariye jay). Ei browser-e notun token boshe jay.
            </p>
            <button className="abtn" onClick={logoutAll} disabled={busy === "logout_all"}>{busy === "logout_all" ? "…" : "Log out everywhere"}</button>

            <div style={{ marginTop: 16 }}>
              <b style={{ fontSize: 13 }}>Recent sign-in activity</b>
              <div style={{ marginTop: 6, fontSize: 12.5 }}>
                {logins.length === 0 ? <div style={{ color: "var(--muted)" }}>No history yet.</div> : logins.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ flex: 1, color: l.action.includes("FAILED") ? "var(--ad-red, #b42318)" : undefined }}>{LOGIN_LABEL[l.action] || l.action}</span>
                    <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(l.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{l.ip}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
