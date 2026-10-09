"use client";
import { FmtDate } from "@/components/dates";
import { afetch, withToken, copyText } from "@/lib/afetch";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FEATURES } from "@/lib/features";

function ThermalLink({ orderId, token }: { orderId: number; token: string }) {
  const [w, setW] = useState("80");
  useEffect(() => {
    try {
      afetch("/api/admin/settings")
        .then((r) => r.json())
        .then((j) => { const tw = j?.settings?.shipping?.thermalWidth; if (tw) setW(String(tw)); })
        .catch(() => {});
    } catch {}
  }, [token]);
  return <Link className="abtn" href={withToken("/admin/orders/" + orderId + "/receipt?w=" + w)}>🧾 Thermal ({w}mm)</Link>;
}

type Order = any;
const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "ON_HOLD"];

/* Courier fraud check card: provider report (Steadfast/Pathao/RedX/… delivery
   history via FraudBD-compatible API) + our own store history (always real).
   On-demand only — one API call per click, spinner state, honest errors. */
function FraudCheck({ orderId, phone }: { orderId: number; phone: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const [repOpen, setRepOpen] = useState(false);
  const [repType, setRepType] = useState("Cancelled order");
  const [repNote, setRepNote] = useState("");
  const [repMsg, setRepMsg] = useState("");
  const [repBusy, setRepBusy] = useState(false);

  const submitReport = async () => {
    setRepBusy(true); setRepMsg("");
    try {
      const r = await afetch("/api/admin/fraud-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, reason: repType, note: repNote }) });
      const j = await r.json();
      setRepMsg(r.ok ? "✓ Report saved — phone auto-blacklisted" : (j.error || "Failed"));
      if (r.ok) { setRepOpen(false); setRepNote(""); }
    } catch { setRepMsg("Network error"); }
    setRepBusy(false);
    setTimeout(() => setRepMsg(""), 4000);
  };

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const r = await afetch(`/api/admin/orders/${orderId}/fraudcheck`, { method: "POST" });
      const j = await r.json();
      if (r.ok) setRes(j); else setErr(j.error || "Check failed");
    } catch { setErr("Network error"); }
    setBusy(false);
  };

  const tone = (rate?: number, risk?: string) => {
    if (risk === "high" || (rate != null && rate < 50)) return "risk-HIGH";
    if (risk === "medium" || (rate != null && rate < 75)) return "risk-MEDIUM";
    return "risk-LOW";
  };

  return (
    <div className="acard" style={{ marginBottom: 16 }}>
      <div className="acard-h">
        <h3>🛡️ Courier Fraud Check — {phone}</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="abtn" onClick={run} disabled={busy} aria-busy={busy || undefined}>
            {busy && <span className="spinner" aria-hidden="true" />} {busy ? "Checking…" : res ? "Check again" : "Check courier history"}
          </button>
          <button className={"abtn " + (repOpen ? "" : "danger")} onClick={() => setRepOpen(!repOpen)}>🚩 Report fraud</button>
        </div>
      </div>
      {repMsg && <div className="acard-b" style={{ paddingTop: 10, paddingBottom: 0 }}><div className={"noti " + (repMsg.includes("✓") ? "ok" : "err")}>{repMsg}</div></div>}
      {repOpen && (
        <div className="acard-b" style={{ paddingTop: 12, borderBottom: "1px solid #f0f2f5" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="abtn" value={repType} onChange={(e) => setRepType(e.target.value)} aria-label="Report reason">
              <option>Cancelled order</option>
              <option>Returned parcel</option>
              <option>Fake number / unreachable</option>
              <option>Refused to receive</option>
              <option>Address problem</option>
              <option>Abusive behaviour</option>
            </select>
            <input placeholder="Note (optional)" value={repNote} onChange={(e) => setRepNote(e.target.value)} style={{ flex: 1, minWidth: 160, border: "1px solid #d0d5dd", padding: "9px 12px", borderRadius: 5 }} />
            <button className="abtn danger" onClick={submitReport} disabled={repBusy} aria-busy={repBusy || undefined}>
              {repBusy && <span className="spinner" aria-hidden="true" />} {repBusy ? "Reporting…" : "Confirm report"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            Report korle ei number <b>auto-blacklist</b> hobe — bhisher dike ei phone diye notun order place korte parbe na. Vul hole Settings → Fraud Blacklist theke remove korun.
          </div>
        </div>
      )}
      {err && <div className="acard-b" style={{ paddingTop: 12 }}><div className="noti err">{err}</div></div>}
      {!res && !err && (
        <div className="acard-b" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Courier delivery history (Steadfast / Pathao / RedX / Paperfly) + apnar nijer store-er data — shipping er age check korun. Setup: Settings → Courier.
        </div>
      )}
      {res && (
        <div className="acard-b">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <span className="pill DELIVERED">Own store: delivered {res.own.delivered}</span>
            <span className={"pill " + (res.own.cancelled + res.own.returned > 0 ? "CANCELLED" : "DRAFT")}>cancelled {res.own.cancelled} · returned {res.own.returned}</span>
            {res.own.active > 0 && <span className="pill PROCESSING">active {res.own.active}</span>}
            {res.own.successRate != null && <span className={"risk-badge " + tone(res.own.successRate)}>own success {res.own.successRate}%</span>}
          </div>
          {res.stf && (
            res.stf.ok ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: res.provider?.ok ? 14 : 0 }}>
                <span className={"risk-badge " + tone(res.stf.summary?.successRate)}>Steadfast (FREE): {res.stf.summary?.successRate ?? 0}% success</span>
                <span style={{ fontSize: 12, display: "inline-flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <b style={{ color: "#9a7b1e" }}>{res.stf.summary?.total ?? 0} deliveries</b>
                  <b style={{ color: "var(--ok)" }}>{res.stf.summary?.success ?? 0} delivered</b>
                  <b style={{ color: "var(--danger)" }}>{res.stf.summary?.cancel ?? 0} cancelled</b>
                </span>
              </div>
            ) : (
              <div className={"noti " + (res.stf.configured ? "err" : "ok")} style={{ marginBottom: res.provider?.ok ? 14 : 0, fontSize: 12.5 }}>
                {res.stf.configured
                  ? "Steadfast free check fail: " + (res.stf.error || "unknown")
                  : "Steadfast FREE check: Settings → Courier e merchant web email + password din (portal.packzy.com login) — tahole ekhane Steadfast delivery history free dekhajabe."}
              </div>
            )
          )}
          {res.provider?.ok ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <span className={"risk-badge " + tone(res.provider.summary?.successRate)}>
                  All couriers: {res.provider.summary?.successRate ?? "—"}% success
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {res.provider.summary?.total ?? 0} deliveries · {res.provider.summary?.success ?? 0} success · {res.provider.summary?.cancel ?? 0} cancel ({res.provider.provider})
                </span>
              </div>
              <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Courier</th><th>Total</th><th>Success</th><th>Cancel</th><th>Success %</th><th>Risk</th></tr></thead>
                <tbody>
                  {(res.provider.couriers || []).map((c: any) => (
                    <tr key={c.name}>
                      <td><b>{c.name}</b></td>
                      <td>{c.total}</td>
                      <td>{c.success}</td>
                      <td>{c.cancel}</td>
                      <td>{c.total ? (c.successRate ?? Math.round((c.success / c.total) * 100)) + "%" : "—"}</td>
                      <td>{c.risk || c.message ? <span className={"risk-badge " + tone(undefined, c.risk)}>{String(c.message || c.risk).replace(/_/g, " ")}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          ) : (
            <div className="noti err" style={{ marginTop: 6 }}>
              Provider report: {res.provider?.error || "not configured"} — nijer store-er data upore dekhachhe. API key add korun: Settings → Courier.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OrderDetailClient({ initial }: { initial: Order }) {
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState(o.adminNote || "");
  const [edit, setEdit] = useState({ name: o.name, phone: o.phone, address: o.address });
  const [editing, setEditing] = useState(false);

  /* ---- item editing state ---- */
  const [itemsEd, setItemsEd] = useState<any[] | null>(null); // null = view mode
  const [deliveryEd, setDeliveryEd] = useState<string>("");
  const [totalEd, setTotalEd] = useState<string>("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [picker, setPicker] = useState<{ open: boolean; rowIdx: number | null }>({ open: false, rowIdx: null });
  const [pq, setPq] = useState("");
  const [pRes, setPRes] = useState<any[] | null>(null);
  const [pBusy, setPBusy] = useState(false);
  const [pickSel, setPickSel] = useState<{ productId: number; variantId: number | null; qty: string } | null>(null);

  const startItemsEdit = () => {
    setItemsEd(o.items.map((i: any) => ({ ...i })));
    setDeliveryEd(String(Math.round(o.deliveryFee || 0)));
    setTotalEd(String(Math.round(o.total || 0)));
    setTotalTouched(false);
  };
  const cancelItemsEdit = () => { setItemsEd(null); setPicker({ open: false, rowIdx: null }); setPickSel(null); setPRes(null); setPq(""); };
  const liveSubtotal = (itemsEd ?? o.items).reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const computedTotal = Math.max(0, liveSubtotal - (o.discount || 0) + (Number(deliveryEd) || 0));
  const shownTotal = totalTouched ? (Number(totalEd) || 0) : computedTotal;

  const openPicker = (rowIdx: number | null) => {
    setPicker({ open: true, rowIdx });
    setPq(""); setPRes(null); setPickSel(null);
    setTimeout(() => { const el = document.getElementById("ordpick-q"); el?.focus(); }, 50);
  };
  const searchPicker = async () => {
    setPBusy(true);
    try {
      const r = await afetch("/api/admin/products" + (pq.trim() ? "?q=" + encodeURIComponent(pq.trim()) : ""));
      const j = await r.json();
      setPRes((j.products || []).slice(0, 12));
    } catch { setPRes([]); }
    setPBusy(false);
  };
  const applyPickRow = (prod: any, v: any, qtyStr: string) => {
    const row = {
      productId: prod.id, variantId: v?.id ?? null,
      title: prod.title, variant: v ? [v.size, v.color].filter(Boolean).join(" · ") : null,
      image: prod.images?.[0]?.url || null, price: v?.price != null ? Number(v.price) : Number(prod.price),
      qty: Math.max(1, Number(qtyStr) || 1),
    };
    if (picker.rowIdx != null) {
      // replace that row's product (drop its id → server removes old + adds new)
      setItemsEd((cur) => (cur || []).map((x, i) => (i === picker.rowIdx ? { ...row } : x)));
    } else {
      setItemsEd((cur) => [...(cur || []), { ...row }]);
    }
    setPicker({ open: false, rowIdx: null }); setPickSel(null); setPRes(null); setPq("");
  };
  const applyPickFor = (prod: any, v: any, qtyStr: string) => applyPickRow(prod, v, qtyStr);
  const saveItems = async () => {
    if (!itemsEd || itemsEd.length === 0) { setMsg("Order e at least ekta item thakte hobe"); return; }
    const body: any = {
      items: itemsEd.map((i) => ({ id: i.id, productId: i.productId, variantId: i.variantId ?? null, price: Number(i.price) || 0, qty: Number(i.qty) || 1 })),
      deliveryFee: Number(deliveryEd) || 0,
      total: shownTotal,
    };
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/orders/" + o.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) { setItemsEd(null); setMsg("Items updated ✓ — totals synced"); router.refresh(); }
    else setMsg(j.error || "Item update failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 4000);
  };

  const copy = async (label: string, text: string) => {
    const ok = await copyText(text);
    setMsg(ok ? `📋 ${label} copied ✓` : "Copy failed");
    setTimeout(() => setMsg(""), 1800);
  };
  const downloadOrder = () => {
    const L = [];
    L.push("========== ORDER ==========");
    L.push(`Order : ${o.code}`);
    L.push(`Date  : ${new Date(o.createdAt).toLocaleString("en-GB")}`);
    L.push(`Name  : ${o.name}`);
    L.push(`Phone : ${o.phone}`);
    L.push(`Address: ${o.address}`);
    L.push(`Zone  : ${o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}`);
    L.push(`Payment: ${o.paymentMethod}`);
    L.push("--------------------------");
    o.items.forEach((i: any, k: number) => {
      L.push(`${k + 1}. ${i.title}${i.variant ? " (" + i.variant + ")" : ""} x${i.qty} = ৳${Math.round(i.price * i.qty).toLocaleString("en-IN")}`);
    });
    L.push("--------------------------");
    L.push(`Subtotal : ৳${Math.round(o.subtotal).toLocaleString("en-IN")}`);
    if (o.discount > 0) L.push(`Discount : -৳${Math.round(o.discount).toLocaleString("en-IN")}${o.couponCode ? " (" + o.couponCode + ")" : ""}`);
    L.push(`Delivery : ৳${Math.round(o.deliveryFee).toLocaleString("en-IN")}`);
    L.push(`TOTAL    : ৳${Math.round(o.total).toLocaleString("en-IN")} (${o.paymentMethod})`);
    if (o.courierConsignmentId) {
      L.push("==========================");
      L.push(`Courier  : ${o.courierName || "Steadfast"}`);
      L.push(`Consignment ID: ${o.courierConsignmentId}`);
      try { const ct = JSON.parse(o.courierTracking || "{}"); if (ct.tracking_code) L.push(`Tracking  : ${ct.tracking_code}`); } catch {}
    }
    L.push(`Status   : ${o.status}`);
    L.push("==========================");
    const blob = new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = o.code + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const put = async (body: any, noteMsg?: string) => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/orders/" + o.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) { setO({ ...o, ...body }); setMsg(noteMsg || "Saved ✓"); router.refresh(); }
    else setMsg(j.error || "Failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 2500);
  };

  const sendCourier = async () => {
    if (!confirm("Send this order to Steadfast courier?")) return;
    setBusy(true); setMsg("");
    const r = await afetch(`/api/admin/orders/${o.id}/courier`, { method: "POST" });
    const j = await r.json();
    if (r.ok) {
      setO({ ...o, courierName: "Steadfast", courierConsignmentId: j.consignment?.consignment_id, courierStatus: j.consignment?.delivery_status });
      setMsg("Sent to Steadfast ✓ " + (j.consignment?.consignment_id || ""));
    } else {
      setMsg(j.configured === false ? "⚠ Steadfast is NOT CONFIGURED — add API keys in Settings > Courier" : "Courier error: " + (j.error || "unknown"));
    }
    setBusy(false);
  };
  const quickBlock = async (type: string, value: string) => {
    if (!value) return;
    if (!confirm(`Blacklist ${type}: ${value}?`)) return;
    setBusy(true);
    const r = await afetch("/api/admin/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, value, note: "manual: from order " + o.code }) });
    setMsg(r.ok ? `🚫 ${type} blacklisted ✓` : "Blacklist failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 3000);
  };

  const trackCourier = async () => {
    setBusy(true); setMsg("");
    const r = await afetch(`/api/admin/orders/${o.id}/courier`);
    const j = await r.json();
    if (r.ok) { setO({ ...o, courierStatus: j.data?.delivery_status || o.courierStatus }); setMsg("Courier status: " + (j.data?.delivery_status || "unknown")); }
    else setMsg(j.configured === false ? "⚠ Steadfast NOT CONFIGURED" : "Courier error: " + (j.error || ""));
    setBusy(false);
  };

  const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>{o.code}</h1>
          <div className="who">Placed <FmtDate iso={o.createdAt} /> · Updated <FmtDate iso={o.updatedAt} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="abtn" onClick={downloadOrder}>⭳ Download</button>
          <ThermalLink orderId={o.id} token={(() => { try { return new URLSearchParams(location.search).get("t") || localStorage.getItem("sz_admin_token") || ""; } catch { return ""; } })()} />
          <Link className="abtn" href={withToken("/admin/dashboard")}>← Back to Dashboard</Link>
          <Link className="abtn" href={withToken("/admin/orders/" + o.id + "/invoice")} target="_blank">🖨 Invoice</Link>
          {!o.courierConsignmentId
            ? <button className="abtn primary" onClick={sendCourier} disabled={busy}>🚚 Send to Steadfast</button>
            : <button className="abtn" onClick={trackCourier} disabled={busy}>🔄 Refresh courier status</button>}
        </div>
      </div>
      {msg && <div className="noti ok">{msg}</div>}
      {o.riskLevel !== "LOW" && (
        <div className="noti err">⚠ Risk level: <b>{o.riskLevel}</b>{o.riskFlags ? " — " + o.riskFlags : ""} — review before shipping.</div>
      )}
      <FraudCheck orderId={o.id} phone={o.phone} />

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start"  }}>
        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h">
              <h3>Items</h3>
              {!itemsEd
                ? <button className="abtn sm" onClick={startItemsEdit}>✏️ Edit items</button>
                : <div style={{ display: "flex", gap: 8 }}>
                    <button className="abtn sm primary" onClick={saveItems} disabled={busy} aria-busy={busy || undefined}>{busy && <span className="spinner" aria-hidden="true" />}Save items</button>
                    <button className="abtn sm" onClick={cancelItemsEdit} disabled={busy}>Cancel</button>
                  </div>}
            </div>

            {!itemsEd ? (
              <>
                <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Product</th><th>Variant</th><th>Price</th><th>Qty</th><th>Total</th></tr></thead>
                  <tbody>
                    {o.items.map((i: any) => (
                      <tr key={i.id}>
                        <td>{i.image && <img src={i.image} alt="" style={{ display: "inline", marginRight: 10, verticalAlign: "middle" }} />}{i.title}{i.preorder ? <span className="po-tag">Pre-order{i.preorderDate ? " · " + new Date(i.preorderDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span> : null}</td>
                        <td>{i.variant || "—"}</td>
                        <td>{money(i.price)}</td><td>{i.qty}</td><td><b>{money(i.price * i.qty)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div className="acard-b" style={{ borderTop: "1px solid #e4e7ec" }}>
                  <div className="sum-row"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
                  {o.discount > 0 && <div className="sum-row"><span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span><span>−{money(o.discount)}</span></div>}
                  <div className="sum-row"><span>Delivery ({o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"})</span><span>{money(o.deliveryFee)}</span></div>
                  <div className="sum-row total"><span>Total {o.paymentMethod === "COD" ? "(COD)" : ""}</span><span>{money(o.total)}</span></div>
                </div>
              </>
            ) : (
              <div className="acard-b">
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  Item add / remove / qty-price change korun. Product change korle ager product er stock ferot hobe, notun product er stock kata hobe. Save items na chaple kichu save hobe na.
                </div>
                <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Product</th><th>Variant</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead>
                  <tbody>
                    {itemsEd.map((i: any, idx: number) => (
                      <tr key={i.id ?? "new-" + idx}>
                        <td>
                          {i.image && <img src={i.image} alt="" style={{ display: "inline", marginRight: 8, verticalAlign: "middle", width: 30, height: 38, objectFit: "cover", borderRadius: 3 }} />}
                          <span style={{ verticalAlign: "middle" }}>{i.title}</span>
                        </td>
                        <td style={{ fontSize: 12.5 }}>{i.variant || "—"}</td>
                        <td><input type="number" min={0} value={i.price} onChange={(e) => setItemsEd((cur) => (cur || []).map((x, k) => (k === idx ? { ...x, price: e.target.value } : x)))} style={{ width: 82, padding: "6px 8px" }} /></td>
                        <td><input type="number" min={1} value={i.qty} onChange={(e) => setItemsEd((cur) => (cur || []).map((x, k) => (k === idx ? { ...x, qty: e.target.value } : x)))} style={{ width: 60, padding: "6px 8px" }} /></td>
                        <td><b>{money((Number(i.price) || 0) * (Number(i.qty) || 0))}</b></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="abtn sm" title="Change product" onClick={() => openPicker(idx)}>↻</button>{" "}
                          <button className="abtn sm danger" title="Remove item" onClick={() => setItemsEd((cur) => (cur || []).filter((_, k) => k !== idx))}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="abtn" onClick={() => openPicker(null)}>+ Add product</button>
                </div>
                <div className="sum-row" style={{ marginTop: 14 }}><span>Subtotal</span><span>{money(liveSubtotal)}</span></div>
                {o.discount > 0 && <div className="sum-row"><span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span><span>−{money(o.discount)}</span></div>}
                <div className="sum-row">
                  <span>Delivery ({o.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"})</span>
                  <input type="number" min={0} value={deliveryEd} onChange={(e) => setDeliveryEd(e.target.value)} style={{ width: 90, padding: "6px 8px", textAlign: "right" }} />
                </div>
                <div className="sum-row total">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    Grand Total {o.paymentMethod === "COD" ? "(COD)" : ""}
                    {totalTouched && <button className="linklike" onClick={() => { setTotalTouched(false); setTotalEd(String(Math.round(computedTotal))); }}>auto</button>}
                  </span>
                  <input type="number" min={0} value={totalTouched ? totalEd : String(Math.round(computedTotal))}
                    onChange={(e) => { setTotalTouched(true); setTotalEd(e.target.value); }}
                    style={{ width: 110, padding: "7px 9px", textAlign: "right", fontWeight: 700 }} />
                </div>
                {totalTouched && Number(totalEd) !== computedTotal && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>⚠ Manual total — auto hishebe {money(computedTotal)} hoto</div>
                )}
              </div>
            )}
          </div>

          <div className="acard">
            <div className="acard-h"><h3>Customer</h3>{!editing && <button className="abtn sm" onClick={() => setEditing(true)}>Edit</button>}{editing && <button className="abtn sm primary" onClick={() => { put(edit, "Customer updated ✓"); setEditing(false); }} disabled={busy}>Save</button>}</div>
            <div className="acard-b">
              {editing ? (
                <div className="form-grid">
                  <div className="af"><label>Name</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                  <div className="af"><label>Phone</label><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                  <div className="af full"><label>Address</label><textarea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} style={{ minHeight: 70 }} /></div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>{o.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {o.phone}
                    <button className="abtn sm" title="Copy phone" onClick={() => copy("Phone", o.phone)}>📋</button>
                    {o.email ? <span>{o.email}</span> : null}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6 }}>{o.address}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                    Source: <b>{o.source || "Direct"}</b>
                    {o.attribution && (o.attribution.utm_source || o.attribution.fbclid) ? <> · UTM: {o.attribution.utm_source || "—"} / {o.attribution.utm_medium || "—"} {o.attribution.utm_campaign ? "· " + o.attribution.utm_campaign : ""} {o.attribution.fbclid ? "· fbclid ✓" : ""}</> : null}
                    {o.ip ? <> · IP: {o.ip}</> : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="abtn sm" disabled={busy} onClick={() => copy("Phone", o.phone)}>📋 Copy phone</button>
                    {/* WhatsApp tool — hidden while lib/features.ts e adminWhatsapp off ache */}
                    {FEATURES.adminWhatsapp && (
                      <a className="abtn sm" style={{ color: "var(--ok)", borderColor: "#c4dfd0", fontWeight: 600 }}
                        href={"https://wa.me/" + (() => { let d = o.phone.replace(/[^0-9]/g, ""); if (d.startsWith("0")) d = "88" + d; else if (!d.startsWith("880")) d = "880" + d; return d; })()}
                        target="_blank" rel="noreferrer">💬 WhatsApp customer</a>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="abtn sm danger" disabled={busy} onClick={() => quickBlock("PHONE", o.phone)}>🚫 Block phone</button>
                    {o.ip && o.ip !== "0.0.0.0" && <button className="abtn sm danger" disabled={busy} onClick={() => quickBlock("IP", o.ip)}>🚫 Block IP</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="acard" style={{ marginBottom: 16 }}>
            <div className="acard-h"><h3>Fulfillment</h3></div>
            <div className="acard-b">
              <div className="af" style={{ marginBottom: 12 }}>
                <label>Order Status</label>
                <select value={o.status} onChange={(e) => put({ status: e.target.value }, "Status → " + e.target.value)} disabled={busy}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="af" style={{ marginBottom: 12 }}>
                <label>Payment Status</label>
                <select value={o.paymentStatus} onChange={(e) => put({ paymentStatus: e.target.value }, "Payment → " + e.target.value)} disabled={busy}>
                  <option>PENDING</option><option>PAID</option><option>FAILED</option><option>REFUNDED</option>
                </select>
              </div>
              <div className="af">
                <label>Admin Note</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal notes…" style={{ minHeight: 70 }} />
                <button className="abtn sm" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => put({ adminNote: note }, "Note saved ✓")} disabled={busy}>Save note</button>
              </div>
            </div>
          </div>

          <PaymentsCard orderId={o.id} total={o.total} />

          <div className="acard">
            <div className="acard-h"><h3>Courier</h3></div>
            <div className="acard-b" style={{ fontSize: 13.5 }}>
              {o.courierName ? (
                <>
                  <div><b>{o.courierName}</b></div>
                  <div style={{ color: "var(--muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    Consignment: {o.courierConsignmentId}
                    <button className="abtn sm" title="Copy consignment ID" onClick={() => copy("Consignment ID", o.courierConsignmentId)}>📋</button>
                  </div>
                  <div style={{ marginTop: 4 }}>Status: <span className="pill SHIPPED">{o.courierStatus || "unknown"}</span></div>
                </>
              ) : (
                <div style={{ color: "var(--muted)" }}>Not sent to any courier yet.</div>
              )}
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                Tracking: {o.code} · {o.phone}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- product picker overlay (item editing) ---- */}
      {picker.open && (
        <div className="modal-bg" onClick={() => setPicker({ open: false, rowIdx: null })}>
          <div className="modal" style={{ width: "min(560px, 94vw)", maxHeight: "82vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPicker({ open: false, rowIdx: null })} aria-label="Close">×</button>
            <h3 style={{ fontFamily: "var(--font-head)", marginBottom: 4 }}>{picker.rowIdx != null ? "Change product" : "Add product"}</h3>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
              {picker.rowIdx != null ? "Ei row er product replace hobe (ager product er stock ferot hobe)" : "Order e notun product add hobe (stock kata hobe)"}
            </div>
            <form style={{ display: "flex", gap: 8, marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); searchPicker(); }}>
              <input id="ordpick-q" placeholder="Product khunje din (title / SKU)…" value={pq} onChange={(e) => setPq(e.target.value)} style={{ flex: 1, padding: "9px 12px", border: "1px solid #d0d5dd", borderRadius: 5 }} autoCapitalize="none" />
              <button className="abtn primary" type="submit" disabled={pBusy} aria-busy={pBusy || undefined}>{pBusy ? "…" : "Search"}</button>
            </form>
            {pRes === null && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Search chapun — sob active product dekhajabe.</div>}
            {pRes !== null && pRes.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Kichu pay nai — onno keyword try korun.</div>}
            {pRes !== null && pRes.map((prod) => {
              const vs = (prod.variants || []).filter((v: any) => v.stock > 0);
              const sel = pickSel?.productId === prod.id ? pickSel : null;
              const chosen = sel ? (prod.variants || []).find((x: any) => x.id === sel.variantId) || vs[0] || null : null;
              return (
                <div key={prod.id} style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {prod.images?.[0] && <img src={prod.images[0].url} alt="" style={{ width: 38, height: 48, objectFit: "cover", borderRadius: 4 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13.5 }}>{prod.title}</b>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>৳{Number(prod.price).toLocaleString("en-IN")} · stock {prod.stock} · {vs.length} variant in stock</div>
                    </div>
                    {(!sel && vs.length === 0) ? (
                      <button className="abtn sm primary" onClick={() => { setPickSel({ productId: prod.id, variantId: null, qty: "1" }); applyPickFor(prod, null, "1"); }}>Select + Add</button>
                    ) : (
                      <button className={"abtn sm" + (sel ? " primary" : "")} onClick={() => setPickSel({ productId: prod.id, variantId: vs[0]?.id ?? null, qty: "1" })}>{sel ? "Selected ✓" : "Select"}</button>
                    )}
                  </div>
                  {sel && (
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid #f0f2f5", paddingTop: 10 }}>
                      {vs.length > 0 && (
                        <select value={sel.variantId ?? ""} onChange={(e) => setPickSel({ ...sel, variantId: Number(e.target.value) || null })} style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5, flex: 1, minWidth: 150 }}>
                          {vs.map((v: any) => (
                            <option key={v.id} value={v.id}>{[v.size, v.color].filter(Boolean).join(" · ") || "Default"} — ৳{Number(v.price ?? prod.price).toLocaleString("en-IN")} ({v.stock} pc)</option>
                          ))}
                        </select>
                      )}
                      <input type="number" min={1} value={sel.qty} onChange={(e) => setPickSel({ ...sel, qty: e.target.value })} style={{ width: 64, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} aria-label="Quantity" />
                      <button className="abtn primary" onClick={() => applyPickRow(prod, chosen, sel.qty)}>{picker.rowIdx != null ? "Replace" : "Add to order"}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/* ---- Payments: what the customer has actually paid -------------------------------
   Rows live in the Payment table; the order total never gets hand-edited to "look paid".
   COD is the normal case here, so the balance shown is what the rider has to collect. */
const PAY_METHODS = [["bkash", "bKash"], ["nagad", "Nagad"], ["rocket", "Rocket"], ["bank", "Bank"], ["cash", "Cash"], ["other", "Other"]];
const PAY_KINDS = [["ADVANCE", "Advance"], ["DUE", "Collected at delivery"], ["REFUND", "Refund"]];

function PaymentsCard({ orderId, total }: { orderId: number; total: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [form, setForm] = useState({ amount: "", method: "bkash", kind: "ADVANCE", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = async () => {
    const r = await afetch(`/api/admin/orders/${orderId}/payments`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setRows(j.rows || []); setSum(j.summary || null); }
    else setRows([]);
  };
  useEffect(() => { load(); }, [orderId]);

  const money = (n: number) => "৳" + Number(n || 0).toLocaleString("en-IN");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await afetch(`/api/admin/orders/${orderId}/payments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Could not save", ok: false }); return; }
    setMsg({ text: `Saved — paid ${money(j.summary.net)}, still due ${money(j.summary.balance)}`, ok: true });
    setForm({ amount: "", method: form.method, kind: form.kind, note: "" });
    load(); router.refresh();
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this payment entry? The order's paid amount will drop accordingly.")) return;
    setBusy(true);
    const r = await afetch(`/api/admin/orders/${orderId}/payments?paymentId=${id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) { load(); router.refresh(); }
  };

  return (
    <div className="acard" style={{ marginBottom: 16 }}>
      <div className="acard-h">
        <h3>Payments</h3>
        {sum && (
          <span style={{ fontSize: 12.5 }}>
            <b style={{ color: sum.balance <= 0.5 ? "var(--ok)" : "var(--ad-red, #b42318)" }}>
              {sum.balance > 0.5 ? money(sum.balance) + " to collect" : sum.balance < -0.5 ? money(-sum.balance) + " overpaid" : "fully paid"}
            </b>
            <span style={{ color: "var(--muted)" }}> · paid {money(sum.net)} of {money(total)}</span>
          </span>
        )}
      </div>
      <div className="acard-b" style={{ fontSize: 13 }}>
        {rows === null ? <div style={{ color: "var(--muted)" }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Nothing paid yet — the full {money(total)} is due at delivery.</div>
        ) : (
          <div className="tbl-scroll">
          <table className="tbl" style={{ marginBottom: 12 }}>
            <thead><tr><th>When</th><th>Kind</th><th>Method</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{r.kind}</td>
                  <td>{r.method}{r.note ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.note}</div> : null}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.kind === "REFUND" ? "var(--ad-red, #b42318)" : undefined }}>{r.kind === "REFUND" ? "−" : ""}{money(r.amount)}</td>
                  <td><button className="abtn sm" disabled={busy} onClick={() => remove(r.id)} title="Remove entry">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        <form onSubmit={add} style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} type="number" min="1" step="0.01" placeholder="Amount ৳" required style={{ width: 120, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }}>
              {PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }}>
              {PAY_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {sum && sum.balance > 0.5 && (
              <button type="button" className="abtn sm" onClick={() => setForm({ ...form, amount: String(Math.round(sum.balance)) })} title="Fill the remaining balance">Full {money(sum.balance)}</button>
            )}
          </div>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note — bKash TrxID, rider name…" style={{ padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
          <button className="abtn primary" type="submit" disabled={busy || !form.amount} style={{ justifySelf: "start" }}>{busy ? "…" : "Add payment"}</button>
          {msg && <div className={"noti " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
        </form>
      </div>
    </div>
  );
}
