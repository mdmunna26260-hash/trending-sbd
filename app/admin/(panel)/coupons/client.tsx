"use client";
import { afetch, withToken } from "@/lib/afetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURES } from "@/lib/features";
const EMPTY = { code: "", type: "percent", value: "10", minOrder: "", maxDiscount: "", usageLimit: "", perCustomer: "", firstOrderOnly: false, startsAt: "", endsAt: "", active: true };
export default function CouponsClient({ initial }: { initial: any[] }) {
  const router = useRouter();
  const [c, setC] = useState<any>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async () => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/coupons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...c, value: Number(c.value) || 0, minOrder: c.minOrder ? Number(c.minOrder) : null, maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null, usageLimit: c.usageLimit ? Number(c.usageLimit) : null, perCustomer: c.perCustomer ? Number(c.perCustomer) : null, startsAt: c.startsAt || null, endsAt: c.endsAt || null }) });
    const j = await r.json();
    if (r.ok) { setC({ ...EMPTY }); setMsg("Coupon created ✓"); router.refresh(); } else setMsg(j.error || "Failed");
    setBusy(false); setTimeout(() => setMsg(""), 2200);
  };
  const toggle = async (x: any) => { await afetch("/api/admin/coupons/" + x.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !x.active }) }); router.refresh(); };
  const del = async (x: any) => { if (confirm("Delete coupon " + x.code + "?")) { await afetch("/api/admin/coupons/" + x.id, { method: "DELETE" }); router.refresh(); } };
  return (
    <>
      <div className="admin-top"><h1>Coupons &amp; Discounts</h1></div>
      {msg && <div className="noti ok">{msg}</div>}
      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start"  }}>
        <div className="acard">
          <div className="acard-h"><h3>All Coupons ({initial.length})</h3></div>
          <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Used</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {initial.map((x) => (
                <tr key={x.id}>
                  <td><b>{x.code}</b></td>
                  <td>{x.type === "percent" ? "Percent" : x.type === "fixed" ? "Fixed" : "Free ship"}</td>
                  <td>{x.type === "percent" ? x.value + "%" : x.type === "fixed" ? "৳" + x.value : "—"}</td>
                  <td>{x.usedCount}{x.usageLimit ? "/" + x.usageLimit : ""}</td>
                  <td><button className="abtn sm" onClick={() => toggle(x)}>{x.active ? "✓ On" : "Off"}</button></td>
                  <td><button className="abtn sm danger" onClick={() => del(x)}>✕</button></td>
                </tr>
              ))}
              {initial.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", padding: 30 }}>No coupons yet.</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
        <div className="acard">
          <div className="acard-h"><h3>New Coupon</h3></div>
          <div className="acard-b form-grid">
            <div className="af"><label>Code *</label><input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} placeholder="SUMMER20" /></div>
            <div className="af"><label>Type</label>
              <select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}>
                <option value="percent">Percentage off</option>
                <option value="fixed">Fixed amount off</option>
                {/* freeDelivery off (lib/features.ts) — "Free shipping" option lukano. Purono coupon edit korle
                    value ta thik thak dekhate ei condition ta rakha (noile select silently type bodle dito). */}
                {(FEATURES.freeDelivery || c.type === "freeship") && <option value="freeship">Free shipping</option>}
              </select>
            </div>
            <div className="af"><label>Value {c.type === "percent" ? "(%)" : c.type === "fixed" ? "(৳)" : ""}</label><input type="number" value={c.value} onChange={(e) => setC({ ...c, value: e.target.value })} disabled={c.type === "freeship"} /></div>
            <div className="af"><label>Min order (৳)</label><input type="number" value={c.minOrder} onChange={(e) => setC({ ...c, minOrder: e.target.value })} /></div>
            <div className="af"><label>Max discount (৳)</label><input type="number" value={c.maxDiscount} onChange={(e) => setC({ ...c, maxDiscount: e.target.value })} /></div>
            <div className="af"><label>Usage limit</label><input type="number" value={c.usageLimit} onChange={(e) => setC({ ...c, usageLimit: e.target.value })} /></div>
            <div className="af"><label>Per customer limit</label><input type="number" value={c.perCustomer} onChange={(e) => setC({ ...c, perCustomer: e.target.value })} /></div>
            <div className="af"><label>Starts</label><input type="date" value={c.startsAt} onChange={(e) => setC({ ...c, startsAt: e.target.value })} /></div>
            <div className="af"><label>Ends</label><input type="date" value={c.endsAt} onChange={(e) => setC({ ...c, endsAt: e.target.value })} /></div>
            <label className="full" style={{ display: "flex", gap: 8, fontSize: 13.5, alignItems: "center" }}>
              <input type="checkbox" checked={c.firstOrderOnly} onChange={(e) => setC({ ...c, firstOrderOnly: e.target.checked })} /> First order only
            </label>
            <div className="full"><button className="abtn primary" onClick={save} disabled={busy || !c.code} style={{ width: "100%" }}>{busy ? "Saving…" : "Create Coupon"}</button></div>
          </div>
        </div>
      </div>
    </>
  );
}
