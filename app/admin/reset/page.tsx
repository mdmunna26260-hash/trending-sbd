"use client";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ResetForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    fetch("/api/admin/reset-password?token=" + encodeURIComponent(token))
      .then(r => r.json())
      .then(j => { setValid(!!j.valid); setEmail(j.email || ""); })
      .catch(() => setValid(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const j = await r.json();
      if (r.ok && j.ok) { setDone(true); setTimeout(() => router.push("/admin/login?reset=1"), 1500); return; }
      setErr(j.error || "Reset failed.");
    } catch { setErr("Network error."); }
    setBusy(false);
  };

  if (valid === null) {
    return (
      <div className="login-card"><div className="sk-line" style={{ width: "60%", height: 20, margin: "8px 0" }} /><div className="sk-line" style={{ width: "80%", height: 14, margin: "6px 0" }} /></div>
    );
  }
  if (!valid) {
    return (
      <div className="login-card">
        <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>Invalid or expired link</h1>
        <p style={{ color: "var(--ad-sub)", fontSize: 14, lineHeight: 1.6 }}>This password reset link is invalid or has expired (links are valid for 30 minutes).</p>
        <Link href="/admin/login" className="abtn primary" style={{ width: "100%", marginTop: 18, display: "inline-block", textAlign: "center", textDecoration: "none", padding: "12px 14px" }}>Back to login</Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="login-card">
        <div style={{ fontSize: 38, textAlign: "center" }}>✓</div>
        <h1 style={{ textAlign: "center", fontSize: 22, margin: "10px 0 6px" }}>Password updated</h1>
        <p style={{ color: "var(--ad-sub)", fontSize: 14, textAlign: "center" }}>Redirecting to login…</p>
      </div>
    );
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <Link href="/admin/login" style={{ fontSize: 12.5, color: "var(--ad-mute)", textDecoration: "none" }}>← Back to login</Link>
      <h1 style={{ marginTop: 10, fontSize: 22 }}>Set new password</h1>
      <p style={{ color: "var(--ad-sub)", fontSize: 13.5, marginTop: -2 }}>for <b style={{ color: "var(--ad-text)" }}>{email}</b></p>
      <div style={{ marginTop: 18 }}>
        <div className="field">
          <label>New password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 8 characters" autoFocus minLength={8} />
        </div>
        <div className="field">
          <label>Confirm password</label>
          <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Type again" minLength={8} />
        </div>
        {err && <div className="noti err">{err}</div>}
        <button className="abtn primary" style={{ width: "100%", padding: 13, fontSize: 14, marginTop: 10 }} disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </div>
    </form>
  );
}

export default function AdminResetPage() {
  return (
    <Suspense fallback={<div className="login-wrap"><div className="login-card"><div className="sk-line" style={{ width: "60%", height: 20 }} /></div></div>}>
      <div className="login-wrap"><ResetForm /></div>
    </Suspense>
  );
}
