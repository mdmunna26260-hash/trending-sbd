"use client";
import { useEffect, useState } from "react";

/* Admin-only error boundary.
   Most common cause on phones: a deploy happened while the tab was open —
   the cached page references old JS chunks that no longer exist, or the
   session data is gone. Behaviour:
   1. The error is reported to /api/client-error (server-side log, visible in
      Admin → Tracking) so the exact cause is known without the phone console.
   2. One automatic hard reload (cache-busting _r=) recovers stale-chunk crashes.
   3. If it keeps failing, this card shows the REAL error message + a direct
      "Login page" escape (expired-session loops) and the raw error text. */
function report(err: any, url: string) {
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        message: err?.message || "unknown",
        stack: err?.stack || "",
        digest: err?.digest,
        url,
      }),
    }).catch(() => {});
  } catch {}
}

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [details, setDetails] = useState("");
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    console.error("Admin client error:", error);
    const url = typeof location !== "undefined" ? location.pathname + location.search : "";
    report(error, url);
    const msg = [error?.message, error?.digest ? "digest: " + error.digest : ""].filter(Boolean).join(" · ");
    setDetails(msg || "Unknown error");

    // Auto-reload ONCE per session
    let reloaded = false;
    try { reloaded = sessionStorage.getItem("sz_admin_err_reload") === "1"; } catch {}
    if (!reloaded) {
      try { sessionStorage.setItem("sz_admin_err_reload", "1"); } catch {}
      setAttempts(1);
      try {
        if (!location.search.includes("_r=")) {
          const u = new URL(window.location.href);
          u.searchParams.set("_r", String(Date.now()));
          window.location.replace(u.toString());
          return;
        }
      } catch {}
      window.location.reload();
      return;
    }
    setAttempts(2);
  }, [error]);

  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: "var(--muted)", marginBottom: 8 }}>OOPS</div>
          <h1 style={{ fontSize: 22, margin: "0 0 10px", fontFamily: "var(--font-head)" }}>Admin panel load hote pare nai</h1>
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 16 }}>
            {attempts > 1
              ? "Auto-reload try korechilo, kintu somossa thakche. Niche 'Login page' diye abar login korun — beshirbhag khetre etei thik hoye jay."
              : "Page auto-reload hoyechilo. Ekhon-o somossa thakle error detail niche dekhachhe."}
          </p>
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          <a className="abtn primary" style={{ textAlign: "center", padding: 13 }} href="/admin/login">🔑 Login page e jan</a>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="abtn" onClick={() => { try { sessionStorage.removeItem("sz_admin_err_reload"); sessionStorage.removeItem("sz_admin_token"); document.cookie = "sz_session_fb=; path=/; max-age=0"; } catch {} window.location.href = "/admin/login"; }}>🔄 Clear session + login</button>
            <button className="abtn" onClick={() => { try { sessionStorage.removeItem("sz_admin_err_reload"); } catch {} window.location.reload(); }}>↻ Reload page</button>
          </div>
        </div>
        <div style={{ textAlign: "left", background: "rgba(251,125,125,.10)", border: "1px solid rgba(251,125,125,.28)", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", color: "var(--danger)", marginBottom: 6 }}>ERROR DETAIL (ei box ta screenshot pathio):</div>
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "#7a2e1f", fontFamily: "monospace" }}>{details || "…"}</pre>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>
            URL: {typeof location !== "undefined" ? location.pathname + location.search : ""}
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <a className="abtn" href="/">Storefront</a>
        </div>
      </div>
    </div>
  );
}
