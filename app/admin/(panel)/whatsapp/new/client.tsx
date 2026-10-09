"use client";
import { afetch } from "@/lib/afetch";
import { useCallback, useEffect, useRef, useState } from "react";

/* Campaign composer (Phase 3) — left: the message, right: who gets it.

   The audience panel calls the same resolver the send uses, so "kotojon jabe" on screen is exactly
   the number that will be queued. Starting a campaign freezes that list on the campaign row;
   the worker then paces it out (caps, quiet hours, retries and SMS fallback all apply). */

type Hit = { id: number; title: string; slug: string; price: number; comparePrice: number | null; stock: number; status: string; image: string | null };
type Img = { url: string; text?: string };
type Tpl = { key: string; name: string; body: string; mediaMode: string; enabled: boolean };
type Device = { id: number; name: string; status: string; phone: string | null; sentToday: number; dailyCap: number };
type Count = {
  count: number; description: string;
  excluded: { notOptedIn: number; optedOut: number; invalid: number; duplicate: number; recent: number };
  sample: { to: string; name: string; orderId: number | null }[];
  audienceTypes: Record<string, string>;
  stats: { waitlist: number; optOuts: number; collections: { id: number; title: string }[] };
};

const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
const pretty = (wa: string) => (wa || "").replace(/^880/, "0").replace(/\D/g, "");

const SAMPLE = { name: "Rima", store: "TRENDING'S", link: "https://sinzooffcial.com/l/promo", coupon: "SAVE100", date: "22/09/2026" };

export default function NewCampaignClient({ quick, rules, devices, optOuts, bridgeRunning }: {
  quick: string[];
  rules: { couponCode: string; stopLine: boolean; testMode: boolean; testNumber: string; enabled: boolean; quietFrom: string; quietTo: string; fallbackHours: number; smsFallback: boolean };
  devices: Device[]; optOuts: number; bridgeRunning: boolean;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [images, setImages] = useState<Img[]>([]);
  const [products, setProducts] = useState<Hit[]>([]);
  const [coupon, setCoupon] = useState(rules.couponCode || "");
  const [linkTarget, setLinkTarget] = useState("");
  const [shortLink, setShortLink] = useState(true);
  const [deviceIds, setDeviceIds] = useState<number[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");

  const [rule, setRule] = useState<any>({ type: "recent_buyers", days: 60, optedInOnly: true, excludeRecentDays: 0 });
  const [csvText, setCsvText] = useState("");
  const [count, setCount] = useState<Count | null>(null);
  const [counting, setCounting] = useState(false);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [created, setCreated] = useState<{ id: number; status: string; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const r = await afetch("/api/admin/whatsapp/templates");
      const j = await r.json().catch(() => ({}));
      if (r.ok) setTemplates([...(j.events || []), ...(j.custom || [])]);
    })();
  }, []);

  /* ── audience count (debounced, same resolver the send uses) ───────────────── */
  const runCount = useCallback(async (r: any, csv?: string) => {
    setCounting(true);
    const payload = { rule: r.type === "csv" ? { ...r, csvPhones: (csv ?? csvText).split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) } : r };
    const res = await afetch("/api/admin/whatsapp/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    setCounting(false);
    if (res.ok && j.ok) setCount(j);
    else setMsg({ text: j.error || "Count ber korte parlam na", ok: false });
  }, [csvText]);

  useEffect(() => {
    const t = setTimeout(() => { runCount(rule); }, 500);
    return () => clearTimeout(t);
  }, [rule, runCount]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await afetch("/api/admin/whatsapp/preview?q=" + encodeURIComponent(q.trim()));
      const j = await r.json().catch(() => ({}));
      if (r.ok) setHits(j.products || []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true); setMsg(null);
    const fd = new FormData();
    [...files].slice(0, 10 - images.length).forEach((f) => fd.append("files", f));
    const r = await afetch("/api/admin/whatsapp/media", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Upload failed", ok: false }); return; }
    setImages((cur) => [...cur, ...(j.images || []).map((i: any) => ({ url: i.url, text: i.text }))].slice(0, 10));
    if (fileRef.current) fileRef.current.value = "";
  };

  const insertVar = (v: string) => setBody((b) => (b ? `${b} ${v}` : v));

  const templateBody = (t: Tpl) => {
    setBody(t.body);
    setMsg({ text: `Template "${t.name}" copy hoyeche — campaign-er moto edit korun.`, ok: true });
  };

  const preview = body
    .replace(/\{name\}/g, SAMPLE.name)
    .replace(/\{store\}/g, SAMPLE.store)
    .replace(/\{link\}/g, shortLink ? SAMPLE.link : (linkTarget || "https://sinzooffcial.com"))
    .replace(/\{coupon\}/g, coupon || rules.couponCode || SAMPLE.coupon)
    .replace(/\{date\}/g, SAMPLE.date);

  const excludedLine = count
    ? Object.entries(count.excluded).filter(([, v]) => v > 0).map(([k, v]) => `${({ notOptedIn: "opt-in nai", optedOut: "STOP koreche", invalid: "number ভুল", duplicate: "duplicate", recent: "sompriti message peyeche" } as any)[k]} ${v}`).join(" · ")
    : "";

  const save = async (startNow: boolean) => {
    if (!body.trim()) { setMsg({ text: "Message body likhun", ok: false }); return; }
    setBusy(startNow ? "start" : "save"); setMsg(null); setCreated(null);
    const payload: any = {
      action: "create", name, body,
      images: images.map((i) => i.url),
      productIds: products.map((p) => p.id),
      couponCode: coupon || null,
      linkTarget: linkTarget || null,
      shortLink,
      audienceRule: rule.type === "csv" ? { ...rule, csvPhones: csvText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) } : rule,
      deviceIds,
      scheduledAt: scheduledAt || null,
      startNow,
    };
    const r = await afetch("/api/admin/whatsapp/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Save hoy ni", ok: false }); return; }
    onCreated(j.broadcast, startNow, j.tick);
  };

  const [tickNote, setTickNote] = useState("");
  const onCreated = (b: any, startNow: boolean, tick: any) => {
    setCreated({ id: b.id, status: b.status, total: b.total });
    if (tick) setTickNote(`worker tick: sent ${tick.sent}${tick.failed ? `, failed ${tick.failed}` : ""}${tick.notes?.length ? " · " + tick.notes.slice(0, 2).join("; ") : ""}`);
    setMsg({
      ok: true,
      text: startNow
        ? `Campaign shuru — ${b.total} jon-er list freeze hoyeche. Report: /admin/whatsapp/${b.id}`
        : `Draft save hoyeche (#${b.id}) — ready hole Start chapun.`,
    });
  };

  const connectedDevices = devices.filter((d) => d.status === "CONNECTED");

  return (
    <>
      {!bridgeRunning && <div className="noti err" style={{ marginBottom: 14 }}>Bridge cholche na — campaign queue-te joma thakbe, bridge chalu hole jabe.</div>}
      {rules.testMode && (
        <div className="noti" style={{ marginBottom: 14, background: "#fff7e6", borderColor: "#e8c98a" }}>
          <b>Test mode ON</b> — shob campaign message {rules.testNumber ? pretty(rules.testNumber) : "(test number set korun)"} e jabe, customer-der kache kichu jabe na.
        </div>
      )}
      {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginBottom: 14 }}>{msg.text}{tickNote ? ` · ${tickNote}` : ""}</div>}
      {created && (
        <div className="noti ok" style={{ marginBottom: 14 }}>
          <a href={`/admin/whatsapp/${created.id}`}>Report dekhun →</a> ({created.status} · target {created.total})
        </div>
      )}

      <div className="wa2-grid">
        <div style={{ display: "grid", gap: 16 }}>
          <div className="acard">
            <div className="acard-h"><h3>Message</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{body.length}/4000</span></div>
            <div className="acard-b" style={{ display: "grid", gap: 12 }}>
              <div className="af"><label>Campaign name (report-e dekhbe)</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Eid offer — best sellers" />
              </div>

              <div className="af"><label>Template theke shuru korun (optional)</label>
                <select value="" onChange={(e) => { const t = templates.find((x) => x.key === e.target.value); if (t) templateBody(t); }}>
                  <option value="">— template bechun —</option>
                  {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </div>

              <div className="af"><label>Body</label>
                <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder={"Assalamu alaikum {name}! 🎉\nEi shopta-te apnar jonno special offer — {coupon} coupon diye 10% chhar.\nDekhe nin 👉 {link}"}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d0d5dd", borderRadius: 6, font: "inherit", fontSize: 13, lineHeight: 1.55, resize: "vertical" }} />
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["{name}", "{link}", "{coupon}", "{store}", "{date}"].map((v) => (
                  <button key={v} className="abtn sm" onClick={() => insertVar(v)}>{v}</button>
                ))}
              </div>

              {quick.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {quick.slice(0, 6).map((qt, i) => (
                    <button key={i} className="abtn sm" title={qt} onClick={() => setBody((b) => (b ? `${b}\n\n${qt}` : qt))}>
                      {qt.slice(0, 26)}{qt.length > 26 ? "…" : ""}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Photos ({images.length}/10) — na dile product-r ছবি jabe</div>
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => upload(e.target.files)} disabled={uploading || images.length >= 10} />
                {uploading && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>upload + compress hocche…</span>}
                {images.length > 0 && (
                  <div className="wa2-thumbs" style={{ marginTop: 10 }}>
                    {images.map((im, i) => (
                      <div key={im.url} className="wa2-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.url} alt="" />
                        <button onClick={() => setImages((cur) => cur.filter((x) => x.url !== im.url))} title="Remove">×</button>
                        <div className="wa2-thumb-tag">{i === 0 ? "1st (caption)" : im.text || ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Product card ({products.length}/3) — naam + দাম + link</div>
                {products.length > 0 && (
                  <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                    {products.map((p) => (
                      <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.image ? <img src={p.image} alt="" style={{ width: 26, height: 32, objectFit: "cover", borderRadius: 3 }} /> : <div style={{ width: 26, height: 32, background: "#eee", borderRadius: 3 }} />}
                        <span style={{ flex: 1 }}>{p.title} · {money(p.price)}</span>
                        <button className="abtn sm" onClick={() => setProducts((cur) => cur.filter((x) => x.id !== p.id))}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
                {products.length < 3 && (
                  <>
                    <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setPicking(true)} placeholder="Product khojun…" />
                    {picking && hits.length > 0 && (
                      <div className="wa2-pick" style={{ marginTop: 8 }}>
                        {hits.filter((h) => !products.some((p) => p.id === h.id)).slice(0, 8).map((h) => (
                          <button key={h.id} className="wa2-pick-row" onClick={() => { setProducts((cur) => [...cur, h].slice(0, 3)); setQ(""); setPicking(false); }}>
                            {h.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={h.image} alt="" /> : <div className="wa2-pick-noimg" />}
                            <span style={{ flex: 1, textAlign: "left" }}>{h.title}<br /><span style={{ color: "var(--muted)" }}>{money(h.price)}</span></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="form-grid">
                <div className="af"><label>Coupon code</label><input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="SAVE100" /></div>
                <div className="af"><label>Link</label><input value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} placeholder="https://sinzooffcial.com/collections/eid (khali = store URL)" /></div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={shortLink} onChange={(e) => setShortLink(e.target.checked)} />
                Short link use korun (click tracking — report-e kotojon click korlo dekhben)
              </label>
            </div>
          </div>

          <div className="acard" style={{ position: "sticky", top: 12 }}>
            <div className="acard-h"><h3>Preview</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>sample: Rima</span></div>
            <div className="acard-b">
              <div className="wa2-phone">
                <div className="wa2-bubble">
                  {images.length > 0 && (
                    <div className="wa2-bubble-imgs">
                      {images.slice(0, 4).map((im) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={im.url} src={im.url} alt="" />)}
                      {images.length > 4 && <div className="wa2-more">+{images.length - 4}</div>}
                    </div>
                  )}
                  <div className="wa2-text">{preview || "Ekhane apnar message dekhabe…"}</div>
                  {products.length > 0 && (
                    <div className="wa2-text" style={{ marginTop: 8, borderTop: "1px dashed rgba(0,0,0,.15)", paddingTop: 8 }}>
                      {products.map((p) => <div key={p.id}>{`*${p.title}*\n💰 ${money(p.price)}\nOrder korun 👉 https://sinzooffcial.com/products/${p.slug}`}</div>)}
                    </div>
                  )}
                  {coupon && <div className="wa2-text" style={{ marginTop: 8 }}>🎟️ Coupon: *{coupon}* — order korar somoy likhun.</div>}
                  {rules.stopLine && <div className="wa2-text" style={{ marginTop: 8, fontStyle: "italic" }}>Offer bondho korte chaile STOP likhun.</div>}
                  <div className="wa2-time">{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ✓✓</div>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
                Preview-te variable sample dekhano hoy. Asol message-e prottek customer-er naam boshe.
                {rules.stopLine ? " STOP line automatic." : " STOP line OFF (rules-e chaalu korun)."}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="acard">
            <div className="acard-h"><h3>Audience</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{optOuts} opted out</span></div>
            <div className="acard-b" style={{ display: "grid", gap: 12 }}>
              <div className="af"><label>Segment</label>
                <select value={rule.type} onChange={(e) => setRule({ ...rule, type: e.target.value })}>
                  {Object.entries(count?.audienceTypes || {
                    recent_buyers: "", all_customers: "", product_buyers: "", collection_buyers: "", high_spenders: "",
                    area: "", waitlist: "", opted_in: "", cancelled_only: "", csv: "",
                  }).map(([k, label]) => <option key={k} value={k}>{label || k}</option>)}
                </select>
              </div>

              {rule.type === "recent_buyers" && (
                <div className="af"><label>শেষ কত দিনে কিনেছে</label><input type="number" min={1} value={rule.days} onChange={(e) => setRule({ ...rule, days: Number(e.target.value) })} /></div>
              )}
              {rule.type === "high_spenders" && (
                <div className="af"><label>কমপক্ষে কত টাকা খরচ</label><input type="number" min={0} value={rule.minSpend} onChange={(e) => setRule({ ...rule, minSpend: Number(e.target.value) })} /></div>
              )}
              {rule.type === "area" && (
                <div className="af"><label>এলাকা</label>
                  <select value={rule.area} onChange={(e) => setRule({ ...rule, area: e.target.value })}>
                    <option value="INSIDE_DHAKA">ঢাকার ভিতরে</option>
                    <option value="OUTSIDE_DHAKA">ঢাকার বাইরে</option>
                  </select>
                </div>
              )}
              {rule.type === "collection_buyers" && (
                <div className="af"><label>Collection</label>
                  <select value={rule.collectionId || ""} onChange={(e) => setRule({ ...rule, collectionId: Number(e.target.value) || null })}>
                    <option value="">— bechun —</option>
                    {(count?.stats.collections || []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              )}
              {rule.type === "product_buyers" && (
                <div className="af"><label>Product</label>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product khojun…" />
                  <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                    {hits.slice(0, 5).map((h) => (
                      <button key={h.id} className={"abtn sm" + (rule.productId === h.id ? " primary" : "")} onClick={() => setRule({ ...rule, productId: h.id })}>{h.title}</button>
                    ))}
                  </div>
                  {rule.productId ? <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Selected product #{rule.productId}</div> : null}
                </div>
              )}
              {rule.type === "csv" && (
                <div className="af"><label>CSV / number list (ek line e ek)</label>
                  <textarea rows={6} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                    placeholder={"Rima,01712345678\nKarim,8801812345678"} />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button className="abtn sm" onClick={() => runCount({ ...rule, type: "csv" }, csvText)}>List-o count korun</button>
                    <button className="abtn sm" onClick={async () => {
                      const r = await afetch("/api/admin/whatsapp/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: csvText }) });
                      const j = await r.json().catch(() => ({}));
                      if (j.ok) { setCsvText((j.phones || []).map((p: string) => pretty(p)).join("\n")); setMsg({ ok: true, text: `${j.count} ta number thik ache (${j.skipped} ta bad)` }); }
                    }}>Parse + clean korun</button>
                  </div>
                </div>
              )}

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={!!rule.optedInOnly} onChange={(e) => setRule({ ...rule, optedInOnly: e.target.checked })} />
                শুধু opt-in করা customer (marketing-e রাজি) — recommended
              </label>
              {!rule.optedInOnly && (
                <div style={{ fontSize: 11.5, color: "var(--danger)" }}>
                  সাবধান: opt-in বন্ধ মানে যারা রাজি হয়নি তাদেরও যাবে — Meta-r policy ar number-er reputation দুটোই ঝুঁকিতে।
                </div>
              )}
              <div className="af"><label>যারা সাম্প্রতিক message পেয়েছে তাদের বাদ দিন (দিন)</label>
                <input type="number" min={0} value={rule.excludeRecentDays} onChange={(e) => setRule({ ...rule, excludeRecentDays: Number(e.target.value) })} placeholder="0 = বাদ দেব না" />
              </div>

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{counting ? "…" : count?.count ?? "—"}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{count?.description || "count ber hocche…"}</div>
                {excludedLine && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>বাদ পড়েছে: {excludedLine}</div>}
                {count?.sample?.length ? (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
                    যেমন: {count.sample.slice(0, 4).map((s) => `${s.name || "—"} (${pretty(s.to)})`).join(", ")}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button className="abtn sm" disabled={counting} onClick={() => runCount(rule)}>Abar count</button>
                  <a className="abtn sm" href="/api/admin/whatsapp/audience?format=csv" onClick={async (e) => {
                    e.preventDefault();
                    const r = await afetch("/api/admin/whatsapp/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rule, format: "csv" }) });
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    const a2 = document.createElement("a");
                    a2.href = url; a2.download = "wa-audience.csv"; a2.click();
                    URL.revokeObjectURL(url);
                  }}>CSV download</a>
                </div>
              </div>
            </div>
          </div>

          <div className="acard">
            <div className="acard-h"><h3>Send</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{connectedDevices.length} device ready</span></div>
            <div className="acard-b" style={{ display: "grid", gap: 12 }}>
              {devices.length > 1 && (
                <div className="af"><label>Device (khali = jeta load kom)</label>
                  <select value={deviceIds[0] || ""} onChange={(e) => setDeviceIds(e.target.value ? [Number(e.target.value)] : [])}>
                    <option value="">Auto — least loaded</option>
                    {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.status}, {d.sentToday}/{d.dailyCap})</option>)}
                  </select>
                </div>
              )}
              <div className="af"><label>Schedule (optional — na dile Start-e sathe sathe)</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="abtn primary" disabled={busy === "start" || !count?.count} onClick={() => save(true)}>
                  {busy === "start" ? "Start hocche…" : `Start korun${count?.count ? ` (${count.count} jon)` : ""}`}
                </button>
                <button className="abtn" disabled={busy === "save"} onClick={() => save(false)}>{busy === "save" ? "Saving…" : "Draft save"}</button>
                {scheduledAt && <button className="abtn" onClick={async () => {
                  await save(false);
                }}>Schedule kore save</button>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                Quiet hours ({rules.quietFrom}–{rules.quietTo})-e campaign thamiye thake, bhorer dike shuru hoy ·
                daily cap ar device warm-up mane hoy · fail hole {rules.smsFallback ? `${rules.fallbackHours} ghontar por SMS fallback` : "retry hoy"}.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
