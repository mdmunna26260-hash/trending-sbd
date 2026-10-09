"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getCfg, setTrackingPhone } from "@/components/store";
import { FEATURES } from "@/lib/features";

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured: "Google login ekhono configure kora hoy nai — admin panel e Client ID/Secret dite hobe.",
  google_state: "Security check fail holo — abar try korun.",
  google_token: "Google theke token nilam na — abar try korun.",
  google_email: "Google account er email verified na.",
  google_error: "Google login e somossa holo — abar try korun.",
};

export default function CustomerLoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const e = sp.get("err");
    if (e) setErr(GOOGLE_ERRORS[e] || e);
    try { setGoogleOn(!!getCfg()?.integrations?.googleLoginEnabled); } catch {}
  }, [sp]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/auth/" + mode, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (r.ok && j.ok) {
        if (form.phone) setTrackingPhone(form.phone); // Meta advanced matching from now on
        // Secure in prod: without it this session cookie is also sent over plain http://
        if (j.token) document.cookie = `sz_customer_fb=${j.token}; path=/; max-age=2592000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        try {
          const probe = await fetch("/api/auth/me");
          if (probe.ok) { router.push("/account"); router.refresh(); return; }
        } catch {}
        router.push(j.token ? "/account?ct=" + encodeURIComponent(j.token) : "/account");
        router.refresh();
      } else { setErr(j.error || "Failed"); setBusy(false); }
    } catch { setErr("Network error"); setBusy(false); }
  };

  return (
    <div style={{ minHeight: "72vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div className="eyebrow">Welcome</div>
          <h1 style={{ fontSize: "clamp(28px,4vw,40px)", margin: "6px 0 4px" }}>{mode === "login" ? "Sign in to your account" : "Create your account"}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Order history, faster checkout, exclusive offers.</p>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          <button className={"chip" + (mode === "login" ? " active" : "")} style={{ cursor: "pointer", flex: 1 }} onClick={() => { setMode("login"); setErr(""); }}>Login</button>
          <button className={"chip" + (mode === "register" ? " active" : "")} style={{ cursor: "pointer", flex: 1 }} onClick={() => { setMode("register"); setErr(""); }}>Register</button>
        </div>
        <form onSubmit={submit} className="acard" style={{ padding: 26, display: "grid", gap: 14 }}>
          {err && <div className="noti err">{err}</div>}
          {mode === "register" && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Full Name *</label>
              <input required name="name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rahim Ahmed" autoCapitalize="words" />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="login-phone">Mobile Number *</label>
            <input required id="login-phone" name="phone" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="numeric" autoCapitalize="none" spellCheck={false} />
          </div>
          {mode === "register" && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Email (optional)</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="login-pass">Password * {mode === "register" && <span style={{ textTransform: "none", letterSpacing: 0 }}>(min 6)</span>}</label>
            <input required id="login-pass" type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </div>
          <button className="btn" style={{ width: "100%" }} disabled={busy} aria-busy={busy || undefined}>
            {busy && <span className="spinner" aria-hidden="true" />}
            <span style={busy ? { marginLeft: 8 } : undefined}>
              {busy ? (mode === "login" ? "Signing in…" : "Creating account…") : mode === "login" ? "Sign In" : "Create Account"}
            </span>
          </button>
          {FEATURES.googleLogin && googleOn && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase" }}>
                <span style={{ flex: 1, height: 1, background: "var(--line)" }} />or<span style={{ flex: 1, height: 1, background: "var(--line)" }} />
              </div>
              <a href="/api/auth/google" className="btn btn-outline" style={{ width: "100%", textDecoration: "none" }} aria-label="Continue with Google">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.6z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5.1L1.3 17.2C3.3 21.2 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.3 6.8C.5 8.4 0 10.1 0 12s.5 3.6 1.3 5.2l3.8-2.9z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.8 1.3 6.8l3.8 2.9c1-3 3.7-5 6.9-5z"/></svg>
                Continue with Google
              </a>
            </>
          )}
          <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
            Order track korte login lagbe na — <Link href="/track" className="link-underline" style={{ textTransform: "none", letterSpacing: 0 }}>Track Order</Link> page use korun.
          </p>
        </form>
      </div>
    </div>
  );
}
