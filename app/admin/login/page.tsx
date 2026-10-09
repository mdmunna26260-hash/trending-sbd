"use client";
import { useEffect, useState } from "react";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [step, setStep] = useState<"password" | "code" | "forgot" | "forgotSent">("password");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOk, setForgotOk] = useState<{ devPreviewUrl?: string; transportConfigured?: boolean } | null>(null);
  const [justReset, setJustReset] = useState(false);

  useEffect(() => {
    try {
      const p = new URLSearchParams(location.search);
      if (p.get("reset") === "1") setJustReset(true);
    } catch {}
  }, []);

  /* One place for "we are in": fallback JS cookie, cookie probe, URL-token fallback.
     Both the password-only path and the 2FA path end here. */
  const finish = async (j: any) => {
    if (j.token) {
      document.cookie = `sz_session_fb=${j.token}; path=/; max-age=604800; SameSite=Lax`;
      try { localStorage.setItem("sz_admin_token", j.token); } catch {}
    }
    try {
      const probe = await fetch("/api/admin/whoami");
      if (probe.ok) { window.location.href = "/admin/dashboard"; return; }
    } catch {}
    if (j.token) { window.location.href = "/admin/dashboard?t=" + encodeURIComponent(j.token); return; }
    window.location.href = "/admin/dashboard";
  };

  const friendly = (msg: string) =>
    msg === "Too many attempts. Try again in a few minutes."
      ? "Onek bar try kora hoyeche — 2-3 minute por abar chin. (Rate limit)"
      : msg;

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true); setForgotOk(null);
    const em = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setErr("Please enter a valid email."); setBusy(false); return; }
    try {
      const r = await fetch("/api/admin/forgot-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      const j = await r.json();
      if (r.ok && j.ok) { setForgotOk(j); setStep("forgotSent"); setBusy(false); return; }
      setErr(j.error || "Could not send reset email.");
    } catch { setErr("Network error."); }
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (step === "code") {
        const r = await fetch("/api/admin/login/2fa", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket, code: code.trim() }),
        });
        const j = await r.json();
        if (r.ok && j.ok) { await finish(j); return; }
        setErr(friendly(j.error || "Code milche na")); setBusy(false); return;
      }
      const r = await fetch("/api/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = await r.json();
      if (j.needs2fa) {
        setTicket(j.ticket); setStep("code"); setBusy(false); setCode("");
        return;
      }
      if (r.ok && j.ok) { await finish(j); return; }
      setErr(friendly(j.error || "Login failed"));
      setBusy(false);
    } catch {
      setErr("Network error — page reload kore abar try korun (server restart hoye thakte pare).");
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="logo">TRENDING&apos;S</span>
        <div className="login-sub">
          {step === "code" ? "Two-factor — authenticator app er 6 digit code" : "Admin Panel — sign in to continue"}
        </div>

        {justReset && (
          <div className="noti ok" style={{ marginBottom: 14 }}>✓ Password updated. Please sign in with your new password.</div>
        )}

        {err && <div className="noti err">{err}</div>}

        {step === "password" ? (
          <>
            <div className="field">
              <label>Email</label>
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
            <div className="field">
              <label>Password</label>
              <div style={{ position: "relative" }}>
                <input type={show ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  style={{ paddingRight: 44 }} />
                <button type="button" onClick={() => setShow(!show)} aria-label="Show password"
                  style={{ position: "absolute", right: 10, top: 9, background: "none", border: "none", fontSize: 15, opacity: .6 }}>
                  {show ? "🙈" : "👁"}
                </button>
              </div>
            </div>
            <button className="abtn primary" style={{ width: "100%", padding: 13, fontSize: 14 }} disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign In"}
            </button>
            <div style={{ textAlign: "right", marginTop: 12 }}>
              <button type="button" onClick={() => { setStep("forgot"); setErr(""); setForgotOk(null); }}
                style={{ background: "none", border: "none", color: "var(--ad-accent)", fontSize: 12.5, cursor: "pointer", padding: 4 }}>
                Forgot password?
              </button>
            </div>
          </>
        ) : step === "forgot" ? (
          <>
            <div className="login-sub" style={{ marginBottom: 8 }}>Reset admin password</div>
            <div className="field">
              <label>Admin email</label>
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
            <div style={{ fontSize: 12, color: "var(--ad-mute)", lineHeight: 1.55, marginBottom: 4 }}>
              Enter the email associated with your admin account. We&apos;ll send a reset link valid for 30 minutes.
            </div>
            <button className="abtn primary" style={{ width: "100%", padding: 13, fontSize: 14 }} disabled={busy} type="button" onClick={submitForgot}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button type="button" className="abtn" style={{ width: "100%", marginTop: 8 }}
              onClick={() => { setStep("password"); setErr(""); setForgotOk(null); }}>
              ← Back to login
            </button>
          </>
        ) : step === "forgotSent" ? (
          <>
            <div style={{ textAlign: "center", padding: "4px 0" }}>
              <div style={{ fontSize: 34 }}>✉️</div>
            </div>
            <div style={{ fontSize: 14, color: "var(--ad-sub)", textAlign: "center", lineHeight: 1.6, marginBottom: 8 }}>
              If an admin account exists for <b style={{ color: "var(--ad-text)" }}>{email}</b>, we&apos;ve sent a password reset link. Check your inbox (and spam folder).
            </div>
            {forgotOk?.devPreviewUrl && (
              <div style={{ marginTop: 12, padding: 12, background: "rgba(246,189,75,.12)", border: "1px solid rgba(246,189,75,.30)", borderRadius: 10, fontSize: 12.5, color: "#ffd88f", lineHeight: 1.55 }}>
                <b>Dev preview:</b> SMTP isn&apos;t configured yet. Use this link to finish the reset:
                <a href={forgotOk.devPreviewUrl} style={{ display: "block", color: "#c2410c", textDecoration: "underline", wordBreak: "break-all", marginTop: 6 }}>{forgotOk.devPreviewUrl}</a>
              </div>
            )}
            <button className="abtn primary" style={{ width: "100%", padding: 12, fontSize: 14, marginTop: 16 }}
              onClick={() => { setStep("password"); setErr(""); setForgotOk(null); }} type="button">
              Back to login
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>6-digit code (or a recovery code)</label>
              <input
                value={code} onChange={(e) => setCode(e.target.value)} required autoFocus
                inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off"
                placeholder="123 456"
                style={{ letterSpacing: ".32em", fontSize: 22, textAlign: "center", fontFamily: "ui-monospace, monospace" }}
              />
            </div>
            <button className="abtn primary" style={{ width: "100%", padding: 13, fontSize: 14 }} disabled={busy || code.replace(/\D/g, "").length < 6} type="submit">
              {busy ? "Checking…" : "Verify & sign in"}
            </button>
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
              Phone hariye gele recovery code din (Admin → Security-e banano).
            </div>
            <button type="button" className="abtn" style={{ width: "100%", marginTop: 8 }}
              onClick={() => { setStep("password"); setCode(""); setTicket(""); setErr(""); }}>
              ← Back to password
            </button>
          </>
        )}
      </form>
    </div>
  );
}
