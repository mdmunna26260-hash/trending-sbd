"use client";
import { FmtDate } from "@/components/dates";
import { afetch, withToken, copyText } from "@/lib/afetch";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type O = {
  id: number; code: string; name: string; phone: string; address: string; area: string; total: number;
  status: string; paymentStatus: string; paymentMethod: string; riskLevel: string;
  channel?: string | null; source?: string | null; courierName?: string | null; courierConsignmentId?: string | null;
  courierStatus?: string | null; createdAt: string; items: { title: string; qty: number; variant?: string | null; preorder?: boolean }[];
};
const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];

export default function OrdersClient({ initial }: { initial: O[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => initial.filter((o) => {
    if (status && o.status !== status) return false;
    if (payment && o.paymentStatus !== payment) return false;
    if (q && ![o.code, o.name, o.phone, o.courierConsignmentId || ""].join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    if (dateFilter) {
      const d = new Date(o.createdAt);
      const now = new Date();
      if (dateFilter === "today") {
        if (d.toDateString() !== now.toDateString()) return false;
      } else if (dateFilter === "yesterday") {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        if (d.toDateString() !== y.toDateString()) return false;
      } else if (dateFilter === "week") {
        if ((now.getTime() - d.getTime()) > 7 * 86400000) return false;
      } else if (dateFilter === "month") {
        if ((now.getTime() - d.getTime()) > 30 * 86400000) return false;
      }
    }
    return true;
  }), [initial, q, status, payment, dateFilter]);

  const openOrder = (id: number) => router.push(withToken("/admin/orders/" + id));

  const copyPhone = async (e: React.MouseEvent, phone: string) => {
    e.preventDefault(); e.stopPropagation();
    const ok = await copyText(phone);
    setBusy(false);
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = ok ? "📋 " + phone + " copied" : "Copy failed";
    document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
  };

  const toggle = (id: number) => {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSel(s);
  };
  const allSel = list.length > 0 && list.every((o) => sel.has(o.id));

  const bulk = async (action: string, value?: string) => {
    if (!sel.size) return;
    if (action === "delete" && !confirm(`Delete ${sel.size} order(s)? This cannot be undone.`)) return;
    setBusy(true);
    await afetch("/api/admin/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), action, value }) });
    setSel(new Set()); setBusy(false); router.refresh();
  };
  const exportCsv = () => { window.location.href = withToken("/api/admin/export?type=orders"); };

  return (
    <>
      <div className="admin-top">
        <h1>Orders <span style={{ fontSize: 14, color: "var(--muted)" }}>({list.length})</span></h1>
        <div className="admin-actions">
          <button className="abtn" onClick={exportCsv}>⭳ Export CSV</button>
          {sel.size > 0 && <>
            <select className="abtn" defaultValue="" onChange={(e) => e.target.value && bulk("status", e.target.value)}>
              <option value="">Set status ({sel.size})…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="abtn" onClick={async () => {
              if (!confirm(`Send ${sel.size} order(s) to Steadfast?`)) return;
              setBusy(true);
              const r = await afetch("/api/admin/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), action: "courier" }) });
              const j = await r.json().catch(() => ({}));
              setBusy(false);
              if (r.ok) { setSel(new Set()); router.refresh(); alert(`Sent: ${j.sent} · Failed: ${j.failed}${j.failed ? "\n" + (j.results || []).filter((x: any) => !x.ok).map((x: any) => x.code + ": " + x.error).join("\n") : ""}`); }
              else alert(j.error || "Failed");
            }}>🚚 Send to Steadfast</button>
            <button className="abtn" onClick={() => {
              const w = window.open("", "_blank");
              if (!w) return;
              const labels = Array.from(sel).map((id) => {
                const o = initial.find((x) => x.id === id);
                if (!o) return "";
                const consignment = o.courierConsignmentId || "—";
                const items = (o.items || []).map((i: any) => `${i.title}${i.variant ? " (" + i.variant + ")" : ""}${i.preorder ? " [PRE-ORDER]" : ""} × ${i.qty}`).join("<br>");
                return `<div style="page-break-after:always;padding:20px 16px;border-bottom:2px solid #333;font-family:Arial,sans-serif">
                  <div style="text-align:center;margin-bottom:12px">
                    <span style="font-family:'Anton Display','Arial Narrow',sans-serif;font-size:19px;font-weight:400;letter-spacing:.06em;text-transform:uppercase">TRENDING&apos;S</span>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Consignment ID</div>
                    <div style="font-size:15px;font-weight:700">${consignment}</div>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Steadfast ID</div>
                    <div style="font-size:13px;font-weight:600">${consignment !== "—" ? "SF-" + consignment : "—"}</div>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Customer Phone</div>
                    <div style="font-size:14px;font-weight:600">${o.phone}</div>
                  </div>
                  <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px">
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Items</div>
                    <div style="font-size:12px;line-height:1.6">${items}</div>
                  </div>
                </div>`;
              }).join("");
              w.document.write("<html><head><style>@font-face{font-family:'Anton Display';font-weight:400;src:url(" + location.origin + "/fonts/anton-latin.woff2) format('woff2')}@media print { .no-print { display:none } } body { margin: 0; background: #fff }</style></head><body>" + labels + "</body></html>");
              w.document.close();
              // wait for the display wordmark font so the printed label isn't in the fallback face
              const go = () => setTimeout(() => w.print(), 200);
              try { w.document.fonts.load("400 19px 'Anton Display'").then(go, go); } catch { go(); }
            }}>🖨 Print labels</button>
            <button className="abtn danger" onClick={() => bulk("delete")}>Delete</button>
          </>}
        </div>
      </div>
      <div className="stat-strip admin-filters">
        <input className="asearch" placeholder="Search code / phone / name / consignment…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="abtn" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="abtn" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payments</option>
          <option value="PENDING">Unpaid</option><option value="PAID">Paid</option>
        </select>
        <select className="abtn" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="">All dates</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select>
      </div>
      <div className="acard">
        <div className="tbl-scroll tbl-sticky tbl-sticky-2">
          <table className="tbl">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(Array.from(list, (o) => o.id)))} /></th>
                <th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Courier</th><th>Risk</th><th>Source</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={12} style={{ color: "var(--muted)", padding: 30 }}>No orders match.</td></tr>}
              {list.map((o) => (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => openOrder(o.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                  <td><Link href={withToken("/admin/orders/" + o.id)} onClick={(e) => e.stopPropagation()}><b>{o.code}</b></Link>{o.channel && o.channel !== "vps" && <span title="Order onugroho onno website theke (Vercel)" style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", color: "#ffd88f", background: "rgba(246,189,75,.16)", borderRadius: 99, padding: "2px 7px", verticalAlign: "middle" }}>{o.channel.toUpperCase()}</span>}</td>
                  <td>{o.name}<br />
                    <span style={{ color: "var(--muted)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {o.phone}
                      <button className="abtn sm" style={{ padding: "0 5px", fontSize: 11 }} title="Copy phone" onClick={(e) => copyPhone(e, o.phone)}>📋</button>
                      <span>· {o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside"}</span>
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{o.items.map((i) => <div key={i.title}>{i.title}{i.variant ? ` (${i.variant})` : ""} ×{i.qty}{i.preorder ? <span className="po-tag">Pre-order</span> : null}</div>)}</td>
                  <td><b>৳{Math.round(o.total).toLocaleString("en-IN")}</b></td>
                  <td><span className={"pill " + o.paymentStatus}>{o.paymentMethod === "COD" ? "COD" : "ONLINE"} · {o.paymentStatus}</span></td>
                  <td><span className={"pill " + o.status}>{o.status}</span></td>
                  <td style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>{o.courierName ? <>{o.courierName}<br /><span style={{ color: "var(--muted)" }}>{o.courierStatus || o.courierConsignmentId}</span></> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  <td><span className={"risk-badge risk-" + o.riskLevel}>{o.riskLevel}</span></td>
                  <td style={{ fontSize: 12 }}>{o.source || "Direct"}</td>
                  <td style={{ fontSize: 12 }}><FmtDate iso={o.createdAt} /></td>
                  <td><Link className="abtn sm" href={withToken("/admin/orders/" + o.id)}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {busy && <div className="toast">Working…</div>}
    </>
  );
}
