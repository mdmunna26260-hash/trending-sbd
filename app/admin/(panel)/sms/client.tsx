"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

/* Composer. Order code first (it fills the customer's number and the {name}/{amount}/{courier}
   placeholders), or type any number for a one-off message. */
export default function SmsComposer({ templates, configured }: { templates: { id: string; label: string; body: string }[]; configured: boolean }) {
  const router = useRouter();
  const [orderCode, setOrderCode] = useState("");
  const [phone, setPhone] = useState("");
  const [template, setTemplate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const parts = Math.max(1, Math.ceil(message.length / 160));
  const bangla = /[\u0980-\u09FF]/.test(message); // 70 chars per part for unicode SMS

  const pick = (id: string) => {
    setTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (t) setMessage(t.body);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await afetch("/api/admin/sms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderCode: orderCode.trim() || undefined, phone: phone.trim() || undefined, message, template }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.ok) setMsg({ text: `Sent to ${j.to} ✓${j.response ? " — gateway: " + String(j.response).slice(0, 80) : ""}`, ok: true });
    else setMsg({ text: (j.error || "Send failed") + (j.configured === false ? " (gateway key missing)" : ""), ok: false });
    router.refresh();
  };

  return (
    <form onSubmit={send} style={{ display: "grid", gap: 10 }}>
      <div className="form-grid">
        <div className="af"><label>Order code (optional)</label>
          <input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="SZ-1042" autoCapitalize="none" style={{ fontFamily: "ui-monospace, monospace" }} />
        </div>
        <div className="af"><label>or phone number</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712 345678" autoCapitalize="none" inputMode="tel" />
        </div>
      </div>
      <div className="af">
        <label>Template</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {templates.map((t) => (
            <button key={t.id} type="button" className={"abtn sm" + (template === t.id ? " primary" : "")} onClick={() => pick(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="af">
        <label>Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={600} placeholder="TRENDING'S: apnar order {code} confirm hoyeche…" style={{ resize: "vertical" }} />
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
          {message.length} characters · {parts} SMS part{parts > 1 ? "s" : ""}{bangla ? " (Bangla = 70 chars/part)" : ""}
          {" · "}placeholders: {"{name} {code} {amount} {courier} {tracking}"}
        </div>
      </div>
      <button className="abtn primary" type="submit" disabled={busy || !message.trim() || (!phone.trim() && !orderCode.trim())} aria-busy={busy || undefined}>
        {busy ? "…" : configured ? "Send SMS" : "Try send (gateway off)"}
      </button>
      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
    </form>
  );
}
