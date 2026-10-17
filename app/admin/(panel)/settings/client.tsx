"use client";
import { afetch, withToken } from "@/lib/afetch";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURES } from "@/lib/features";

const TABS = ["Store", "Theme", "Homepage Layout", "Shipping", "Policies", "Courier", "Checkout & Fraud", "Notifications", "SEO & Maintenance"];
const MAP: Record<string, string> = { Store: "store", Theme: "theme", Shipping: "shipping", Courier: "courier", "Checkout & Fraud": "__multi", "SEO & Maintenance": "__multi2" };

function CourierTestBadge() {
  const [state, setState] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: false });
  const test = async () => {
    setState({ busy: true, msg: "Steadfast API call…" , ok: false });
    const r = await afetch("/api/admin/courier/test", { method: "POST" });
    const j = await r.json();
    if (r.ok && j.ok) setState({ busy: false, msg: "✓ " + (j.detail || "Connected"), ok: true });
    else if (j.configured === false) setState({ busy: false, msg: "⚠ " + (j.error || "Not configured"), ok: false });
    else setState({ busy: false, msg: "✗ " + (j.detail || j.error || "API unreachable"), ok: false });
    setTimeout(() => setState({ busy: false, msg: "", ok: false }), 15000);
  };
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span className="risk-badge risk-LOW">CONFIGURED</span>
      <button className="abtn" onClick={test} disabled={state.busy}>{state.busy ? "Testing…" : "Test Connection"}</button>
      {state.msg && <span style={{ fontSize: 12.5, color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.msg}</span>}
    </span>
  );
}

function WaNumberEditor({ initial, onChanged }: { initial: string; onChanged: () => void }) {
  const [num, setNum] = useState(initial);
  const [waCust, setWaCust] = useState(true);
  const [saved, setSaved] = useState("");
  useEffect(() => { setNum(initial); }, [initial]);
  useEffect(() => {
    afetch("/api/admin/whatsapp").then(async (r) => { if (r.ok) { const j = await r.json(); setWaCust(j.waCustomerEnabled !== false); } }).catch(() => {});
  }, []);
  const save = async () => {
    await afetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: "notifications", value: { waNotifyNumber: num.trim(), waCustomerEnabled: waCust } }) });
    setSaved("Saved ✓");
    setTimeout(() => setSaved(""), 2500);
    onChanged();
  };
  return (
    <div className="form-grid" style={{ marginTop: 18 }}>
      <div className="af"><label>Admin WhatsApp number (notification kobor jabe)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={num} placeholder="8801XXXXXXXXX (country code soho)" onChange={(e) => setNum(e.target.value)} autoCapitalize="none" />
          <button className="abtn primary" onClick={save} type="button">Save</button>
        </div>
      </div>
      <div className="af"><label>Customer confirmation</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, paddingTop: 8 }}>
          <input type="checkbox" checked={waCust} onChange={(e) => setWaCust(e.target.checked)} /> Order hole customer-ke WhatsApp confirm pathao
        </label>
      </div>
      {saved && <div className="noti ok full">{saved}</div>}
    </div>
  );
}

function WhatsAppCard() {
  const router = useRouter();
  const [st, setSt] = useState<any>({ loading: true });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { const r = await afetch("/api/admin/whatsapp"); if (r.ok) setSt(await r.json()); } catch {}
  };
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);
  const logout = async () => {
    if (!confirm("WhatsApp device unlink korbo? Notun QR scan korte hobe.")) return;
    setBusy(true);
    await afetch("/api/admin/whatsapp/logout", { method: "POST" });
    setBusy(false); load();
  };
  const test = async () => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/notifications/test", { method: "POST" });
    const j = await r.json();
    setMsg(r.ok ? "✓ " + (j.detail || "Test pathano hoyeche") : "⚠ " + (j.error || "fail"));
    setBusy(false);
    setTimeout(() => setMsg(""), 8000);
  };
  return (
    <div className="acard" style={{ marginTop: 16 }}>
      <div className="acard-h"><h3>📱 WhatsApp (Linked Device — QR)</h3>
        <span className={"risk-badge " + (st.connected ? "risk-LOW" : st.bridgeRunning ? "risk-MEDIUM" : "risk-HIGH")}>
          {st.loading ? "…" : st.connected ? "CONNECTED" : st.bridgeRunning ? "QR WAITING" : "BRIDGE OFF"}
        </span>
      </div>
      <div className="acard-b">
        {st.connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 30 }}>✅</span>
            <div>
              <div style={{ fontWeight: 600 }}>WhatsApp connected</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{st.me || ""}</div>
            </div>
          </div>
        ) : (
          <QrPanel bridgeRunning={st.bridgeRunning} onPaired={load} />
        )}
        <WaNumberEditor initial={st.waNotifyNumber || ""} onChanged={load} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {st.connected && <button className="abtn danger" onClick={logout} disabled={busy}>Unlink device</button>}
          <button className="abtn primary" onClick={test} disabled={busy}>Send Test</button>
        </div>
        {msg && <div className={"noti " + (msg.includes("✓") ? "ok" : "err")} style={{ marginTop: 10 }}>{msg}</div>}
      </div>
    </div>
  );
}

function QrPanel({ bridgeRunning, onPaired }: { bridgeRunning: boolean; onPaired: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await afetch("/api/admin/whatsapp/qr");
        if (r.ok) {
          const j = await r.json();
          if (j.connected) { stop = true; onPaired(); return; }
          setQr(j.qr); setHint(j.hint || "");
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 4000);
    return () => { stop = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!bridgeRunning) {
    return (
      <div className="cfg-note">⚠ WhatsApp bridge service cholche na. Server console-e <b>npm run wa</b> chalan (thik ase sandbox-e ami chalaiye dicchi). Bridge 127.0.0.1-e private thake.</div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ background: "rgba(8,13,33,.72)", border: "1px solid rgba(122,152,255,.22)", borderRadius: 12, padding: 10, width: 300, textAlign: "center" }}>
        {qr ? <img src={qr} alt="WhatsApp QR" style={{ width: "100%" }} /> : <div style={{ padding: "60px 10px", color: "var(--muted)", fontSize: 13 }}>{hint || "QR asche…"}</div>}
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>QR every ~20s refresh hoy — notun QR hoye jayle auto-update</div>
      </div>
      <div style={{ flex: 1, minWidth: 220, fontSize: 13.5 }}>
        <b>Pair korar niyom:</b>
        <ol style={{ margin: "8px 0 0 18px", display: "grid", gap: 6 }}>
          <li>Phone-e <b>WhatsApp</b> khulun</li>
          <li>Settings (⋮) → <b>Linked devices</b></li>
          <li><b>Link a device</b> → QR scan korun</li>
        </ol>
        <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12.5 }}>Scan hole eta WhatsApp Web-er moto kaj korbe — session save thake, restart-er por-o reconnect hoy.</div>
      </div>
    </div>
  );
}

function TestNotifBtn() {
  const [state, setState] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: false });
  const test = async () => {
    setState({ busy: true, msg: "Sending…", ok: false });
    const r = await afetch("/api/admin/notifications/test", { method: "POST" });
    const j = await r.json();
    if (r.ok && j.ok) setState({ busy: false, msg: "✓ Telegram-e test pathano hoyeche — check korun!", ok: true });
    else if (j.configured === false) setState({ busy: false, msg: "⚠ " + (j.error || "Not configured"), ok: false });
    else setState({ busy: false, msg: "✗ Telegram rejected: " + (j.error || "unknown"), ok: false });
    setTimeout(() => setState({ busy: false, msg: "", ok: false }), 7000);
  };
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
      <button className="abtn" onClick={test} disabled={state.busy}>{state.busy ? "Sending…" : "Send Test"}</button>
      {state.msg && <span style={{ fontSize: 12.5, color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.msg}</span>}
    </span>
  );
}

function TestSmsBtn() {
  const [state, setState] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: false });
  const [phone, setPhone] = useState("");
  const test = async () => {
    const to = phone.trim() || prompt("Test SMS kothay pathabo? Number din (01XXXXXXXXX):") || "";
    if (!to) return;
    setState({ busy: true, msg: "Sending…", ok: false });
    const r = await afetch("/api/admin/sms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: to, message: "TRENDING'S test SMS — gateway thik moto kaj korche ✓" }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) setState({ busy: false, msg: "✓ Sent to " + j.to, ok: true });
    else setState({ busy: false, msg: "✗ " + (j.error || "Send failed"), ok: false });
    setTimeout(() => setState({ busy: false, msg: "", ok: false }), 9000);
  };
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX (test number)" style={{ width: 190, padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} autoCapitalize="none" inputMode="tel" />
      <button className="abtn" onClick={test} disabled={state.busy}>{state.busy ? "Sending…" : "Send test SMS"}</button>
      {state.msg && <span style={{ fontSize: 12.5, color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.msg}</span>}
    </span>
  );
}

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero Banner", values: "Value Props (COD / delivery / returns)", featured: "Featured Collection",
  categories: "Shop by Category", promo: "Promo Banner", bestsellers: "Best Sellers", testimonials: "Reviews",
};
function HomepageLayoutTab({ groups, save, busy, collections = [] }: any) {
  const [secs, setSecs] = useState<any[]>(groups.homeSections?.length ? groups.homeSections : [
    { id: "hero", enabled: true }, { id: "values", enabled: true }, { id: "featured", enabled: true },
    { id: "categories", enabled: true }, { id: "promo", enabled: true }, { id: "bestsellers", enabled: true },
    { id: "testimonials", enabled: true },
  ]);
  const [drag, setDrag] = useState<number | null>(null);
  const move = (i: number, j: number) => {
    if (j < 0 || j >= secs.length) return;
    const next = [...secs];
    [next[i], next[j]] = [next[j], next[i]];
    setSecs(next);
  };
  return (
    <div className="acard">
      <div className="acard-h"><h3>Homepage Sections — order &amp; visibility</h3>
        <button className="abtn primary" onClick={() => save("homeSections", secs)} disabled={busy}>Save Layout</button>
      </div>
      <div style={{ padding: 14, fontSize: 12.5, color: "var(--muted)" }}>⠿ drag kore section reorder korun — homepage thik ei order-e dekhabe. Checkbox off = section hide.</div>
      <div className="tbl-scroll">
      <table className="tbl">
        <tbody>
          {secs.map((s, i) => (
            <tr key={s.id}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag != null) { const next = [...secs]; const [m] = next.splice(drag, 1); next.splice(i, 0, m); setSecs(next); setDrag(null); } }}
              style={{ cursor: "grab", opacity: drag === i ? 0.5 : 1 }}
            >
              <td style={{ width: 60 }}><span style={{ fontSize: 16, color: "var(--muted)" }}>⠿</span></td>
              <td style={{ width: 60, fontSize: 12, color: "var(--muted)" }}>{i + 1}</td>
              <td><b>{SECTION_LABELS[s.id] || s.id}</b></td>
              <td style={{ width: 120 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={!!s.enabled} onChange={(e) => { const next = [...secs]; next[i] = { ...s, enabled: e.target.checked }; setSecs(next); }} /> Show
                </label>
              </td>
              <td style={{ width: 120, whiteSpace: "nowrap" }}>
                <button className="abtn sm" style={{ padding: "1px 8px", marginRight: 4 }} onClick={() => move(i, i - 1)} disabled={i === 0}>↑</button>
                <button className="abtn sm" style={{ padding: "1px 8px" }} onClick={() => move(i, i + 1)} disabled={i === secs.length - 1}>↓</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default function SettingsClient({ groups, user, userCount, hasCourier, collections = [] }: any) {
  const router = useRouter();
  const [tab, setTab] = useState("Store");
  const [g, setG] = useState<any>(groups);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [bl, setBl] = useState({ type: "PHONE", value: "" });

  const save = async (group: string, value: any) => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group, value }) });
    const j = await r.json();
    setMsg(r.ok ? "Settings saved ✓" : j.error || "Failed");
    setBusy(false);
    setTimeout(() => { setMsg(""); if (r.ok) router.refresh(); }, 1200);
  };
  const uploadImg = async (file: File, group: string, key: string) => {
    setBusy(true); setMsg("Uploading image…");
    const fd = new FormData(); fd.append("file", file);
    const r = await afetch("/api/admin/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (r.ok) {
      setG((x: any) => ({ ...x, [group]: { ...x[group], [key]: j.url } }));
      setMsg("Image uploaded ✓ — ekhon Save chapun");
    } else setMsg(j.error || "Upload failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 3500);
  };
  const ImgField = ({ k, label, group }: any) => (
    <div className="af full">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {g[group]?.[k] && <img src={g[group][k]} alt="" style={{ width: 56, height: 70, objectFit: "cover", borderRadius: 4, border: "1px solid #ddd" }} />}
        <input value={g[group]?.[k] ?? ""} onChange={(e) => setG({ ...g, [group]: { ...g[group], [k]: e.target.value } })} style={{ flex: 1, minWidth: 200 }} placeholder="/uploads/…" />
        <label className="abtn" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          ⬆ Upload
          <input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) uploadImg(e.target.files[0], group, k); e.target.value = ""; }} />
        </label>
      </div>
    </div>
  );
  const F = ({ k, label, type = "text", group }: any) => (
    <div className="af">
      <label>{label}</label>
      <input type={type} value={g[group]?.[k] ?? ""} onChange={(e) => setG({ ...g, [group]: { ...g[group], [k]: e.target.value } })} />
    </div>
  );
  const saveBtn = (group: string) => <button className="abtn primary" onClick={() => save(group, g[group])} disabled={busy} aria-busy={busy || undefined}>{busy && <span className="spinner" aria-hidden="true" />} {busy ? "Saving…" : "Save " + group.charAt(0).toUpperCase() + group.slice(1)}</button>;
  const blacklistAdd = async () => {
    if (!bl.value) return;
    // blacklist is stored via settings-less model — use audit+blacklist API? simplest: direct fetch to a tiny route
    const r = await afetch("/api/admin/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bl) });
    if (r.ok) { setMsg("Blacklisted ✓"); setBl({ type: bl.type, value: "" }); router.refresh(); }
  };

  return (
    <>
      <div className="admin-top"><h1>Settings</h1><span className="who">Everything here is editable without touching code.</span></div>
      <div className="settings-nav" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={"chip" + (tab === t ? " active" : "")} style={{ cursor: "pointer" }} onClick={(e) => { setTab(t); e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }}>{t}</button>)}
      </div>
      {msg && <div className="noti ok">{msg}</div>}

      {tab === "Store" && (
        <div className="acard"><div className="acard-h"><h3>Store &amp; Brand</h3></div>
          <div className="acard-b form-grid">
            <F k="name" label="Store name" group="store" />
            <F k="tagline" label="Tagline" group="store" />
            <F k="email" label="Support email" group="store" />
            <F k="phone" label="Support phone" group="store" />
            <F k="whatsapp" label="WhatsApp number (8801…)" group="store" />
            <F k="currencySymbol" label="Currency symbol" group="store" />
            <F k="address" label="Address" group="store" />
            <F k="facebook" label="Facebook URL" group="store" />
            <F k="instagram" label="Instagram URL" group="store" />
            <div className="af full"><label>Footer text</label><input value={g.store?.footerText || ""} onChange={(e) => setG({ ...g, store: { ...g.store, footerText: e.target.value } })} /></div>
            <div className="full">{saveBtn("store")}</div>
          </div>
        </div>
      )}

      {tab === "Theme" && (
        <div className="acard"><div className="acard-h"><h3>Theme &amp; Appearance</h3></div>
          <div className="acard-b form-grid">
            {(["bg:Background", "text:Text color", "accent:Accent color"] as any[]).map((x) => (
              <div className="af" key={x[0]}><label>{x[1]}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="color" value={g.theme?.[x[0]] || "#000000"} onChange={(e) => setG({ ...g, theme: { ...g.theme, [x[0]]: e.target.value } })} style={{ width: 46, padding: 2 }} />
                  <input value={g.theme?.[x[0]] || ""} onChange={(e) => setG({ ...g, theme: { ...g.theme, [x[0]]: e.target.value } })} style={{ flex: 1 }} />
                </div>
              </div>
            ))}
            <div className="af"><label>Heading font</label>
              <select value={g.theme?.headingFont || ""} onChange={(e) => setG({ ...g, theme: { ...g.theme, headingFont: e.target.value } })}>
                <option value="'Didot','Bodoni MT','Playfair Display',Georgia,serif">Elegant Serif (default)</option>
                <option value="Georgia,serif">Georgia</option>
                <option value="-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">System Sans</option>
                <option value="'Courier New',monospace">Monospace</option>
              </select>
            </div>
            <div className="af"><label>Button corner radius (px)</label><input type="number" value={g.theme?.radius ?? 2} onChange={(e) => setG({ ...g, theme: { ...g.theme, radius: Number(e.target.value) } })} /></div>
            <div className="af full"><label>Product image ratio (upload-auto-crop + site-wide)</label>
              <select value={g.theme?.productImageRatio || "3:4"} onChange={(e) => setG({ ...g, theme: { ...g.theme, productImageRatio: e.target.value } })}>
                <option value="3:4">Portrait 3:4 (default)</option>
                <option value="1:1">Square 1:1</option>
                <option value="4:3">Landscape 4:3</option>
                <option value="16:9">Wide 16:9</option>
                <option value="2:3">Tall 2:3</option>
              </select>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Notun upload gulo ei ratio-te automatic crop hobe. Save Theme chapun.</div>
            </div>
            <div className="af"><label>Container width (px)</label><input type="number" value={g.theme?.containerWidth ?? 1280} onChange={(e) => setG({ ...g, theme: { ...g.theme, containerWidth: Number(e.target.value) } })} /></div>

            <div className="af full"><label>Hero headline (supports line breaks)</label><textarea style={{ minHeight: 60 }} value={g.homepage?.heroTitle || ""} onChange={(e) => setG({ ...g, homepage: { ...g.homepage, heroTitle: e.target.value } })} /></div>
            <div className="af full"><label>Hero subtitle</label><input value={g.homepage?.heroSubtitle || ""} onChange={(e) => setG({ ...g, homepage: { ...g.homepage, heroSubtitle: e.target.value } })} /></div>
            <F k="heroCta" label="Hero button text" group="homepage" />
            <ImgField k="heroImage" label="Hero banner image (upload or paste URL)" group="homepage" />
            <F k="promoTitle" label="Promo banner title" group="homepage" />
            <F k="promoText" label="Promo banner text" group="homepage" />
            <ImgField k="promoImage" label="Promo banner image (upload or paste URL)" group="homepage" />
            <F k="featuredCollection" label="Featured collection slug (e.g. new-arrivals)" group="homepage" />
            <div className="full">{saveBtn("theme")}</div>
            <div className="full"><button className="abtn" onClick={() => save("homepage", g.homepage)} disabled={busy}>Save Homepage Content</button></div>
          </div>
        </div>
      )}

      {tab === "Homepage Layout" && (
        <>
          <HomepageLayoutTab groups={g} save={save} busy={busy} collections={collections} />
          <div className="acard" style={{ marginTop: 16 }}>
            <div className="acard-h"><h3>Hero Banner</h3></div>
            <div className="acard-b form-grid">
              <div className="af full"><label>Hero headline</label><textarea style={{ minHeight: 50 }} value={g.homepage?.heroTitle || ""} onChange={(e) => setG({ ...g, homepage: { ...g.homepage, heroTitle: e.target.value } })} /></div>
              <div className="af full"><label>Hero subtitle</label><input value={g.homepage?.heroSubtitle || ""} onChange={(e) => setG({ ...g, homepage: { ...g.homepage, heroSubtitle: e.target.value } })} /></div>
              <F k="heroCta" label="Hero button text" group="homepage" />
              <ImgField k="heroImage" label="Hero banner image" group="homepage" />
              <div className="full">{saveBtn("homepage")}</div>
            </div>
          </div>
          <div className="acard" style={{ marginTop: 16 }}>
            <div className="acard-h"><h3>Promo Banner</h3></div>
            <div className="acard-b form-grid">
              <F k="promoTitle" label="Promo title" group="homepage" />
              <F k="promoText" label="Promo text" group="homepage" />
              <ImgField k="promoImage" label="Promo image" group="homepage" />
              <div className="full">{saveBtn("homepage")}</div>
            </div>
          </div>
          <div className="acard" style={{ marginTop: 16 }}>
            <div className="acard-h"><h3>Featured Collection</h3></div>
            <div className="acard-b form-grid">
              <div className="af full"><label>Featured collection</label>
                <select value={g.homepage?.featuredCollection || "new-arrivals"} onChange={(e) => setG({ ...g, homepage: { ...g.homepage, featuredCollection: e.target.value } })}>
                  {collections.length > 0
                    ? collections.map((c: any) => <option key={c.slug} value={c.slug}>{c.title} (/{c.slug})</option>)
                    : <option value="new-arrivals">New Arrivals</option>}
                </select>
              </div>
              <div className="full" style={{ fontSize: 12.5, color: "var(--muted)" }}>Homepage-er "01 Curated for you" section-e kon collection dekhabe. List ta Categories &amp; Collections page-er sob collection theke ashe — oikhane notun banale ekhane options add hobe.</div>
              <div className="full">{saveBtn("homepage")}</div>
            </div>
          </div>
        </>
      )}

      {tab === "Policies" && (
        <div className="acard"><div className="acard-h"><h3>Returns &amp; Exchange</h3></div>
          <div className="acard-b form-grid">
            <div className="full" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Ei value gulo /returns page e dekhay <b>ar</b> Google er Product markup e <code>MerchantReturnPolicy</code> hisebe jay.
              Ek jaygay bodlale dutoi bodle jabe — page ar markup kokhono alada hobe na.
            </div>
            <F k="returnDays" label="Return window (days from delivery)" type="number" group="policies" />
            <F k="damageReportHours" label="Hours to report a wrong/damaged item" type="number" group="policies" />
            <F k="refundTime" label="Refund time (as shown to customer)" group="policies" />
            <F k="refundMethod" label="Refund method (COD orders)" group="policies" />
            <F k="updated" label="Last updated (shown on the page)" group="policies" />
            <div className="af full">
              <label>Exchange note</label>
              <textarea rows={3} value={g.policies?.exchangeNote ?? ""} onChange={(e) => setG({ ...g, policies: { ...g.policies, exchangeNote: e.target.value } })} />
            </div>
            <div className="af full">
              <label>What can&apos;t be returned (ek line e ekta)</label>
              <textarea rows={4} value={g.policies?.nonReturnable ?? ""} onChange={(e) => setG({ ...g, policies: { ...g.policies, nonReturnable: e.target.value } })} placeholder={"Innerwear, for hygiene reasons.\nWorn or washed items."} />
            </div>
            <div className="af full">
              <label>Extra note (optional — page er niche ekta section hisebe dekhay)</label>
              <textarea rows={3} value={g.policies?.note ?? ""} onChange={(e) => setG({ ...g, policies: { ...g.policies, note: e.target.value } })} />
            </div>
            <div className="af full">
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                <input type="checkbox" checked={g.policies?.freeReturnCourier !== false} onChange={(e) => setG({ ...g, policies: { ...g.policies, freeReturnCourier: e.target.checked } })} />
                Return courier amra bori (free return)
              </label>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Uncheck korle page e &quot;you send it back&quot; dekhabe, ar Google markup e <code>ReturnFeesCustomerResponsibility</code> jabe.</div>
            </div>
            <div className="full">{saveBtn("policies")}</div>
          </div>
        </div>
      )}

      {tab === "Shipping" && (
        <>
        <div className="acard" style={{ marginBottom: 16 }}><div className="acard-h"><h3>🖨 Thermal Printer</h3></div>
          <div className="acard-b form-grid">
            <div className="af"><label>Default receipt width</label>
              <select value={g.shipping?.thermalWidth || "80"} onChange={(e) => setG({ ...g, shipping: { ...g.shipping, thermalWidth: e.target.value } })}>
                <option value="58">58mm (small thermal)</option>
                <option value="80">80mm (wide thermal)</option>
              </select>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Order page-er 🧾 Thermal button ei width-e open hobe.</div>
            </div>
          </div>
        </div>
        <div className="acard"><div className="acard-h"><h3>Delivery Charges (BD)</h3></div>
          <div className="acard-b form-grid">
            <F k="insideDhaka" label="Inside Dhaka fee (৳)" type="number" group="shipping" />
            <F k="outsideDhaka" label="Outside Dhaka fee (৳)" type="number" group="shipping" />
            {/* freeDelivery off (lib/features.ts) — threshold field lukano. Switch on korle ferot ashe. */}
            {FEATURES.freeDelivery && <F k="freeShippingThreshold" label="Free shipping over (৳, 0 = off)" type="number" group="shipping" />}
            <F k="estimateInside" label="Inside Dhaka estimate" group="shipping" />
            <F k="estimateOutside" label="Outside Dhaka estimate" group="shipping" />
            <div className="full">{saveBtn("shipping")}</div>
          </div>
        </div>
        </>
      )}

      {tab === "Courier" && (
        <>
          {!hasCourier && <div className="cfg-note">⚠ Steadfast is <b>NOT CONFIGURED</b> — enter your API Key &amp; Secret Key below. Until then, "Send to Steadfast" will show a configuration warning instead of fake success.</div>}
          {hasCourier && <CourierTestBadge />}
          <div className="acard"><div className="acard-h"><h3>Steadfast Courier</h3></div>
            <div className="acard-b form-grid">
              <F k="apiUrl" label="API URL" group="courier" />
              <F k="merchantId" label="Steadfast Merchant ID (receipt-e print hobe)" group="courier" />
              <F k="apiKey" label="API Key" group="courier" />
              <F k="secretKey" label="Secret Key" group="courier" />
              <F k="insideDhaka" label="Inside Dhaka charge (৳)" type="number" group="courier" />
              <F k="outsideDhaka" label="Outside Dhaka charge (৳)" type="number" group="courier" />
              <div className="full">{saveBtn("courier")}</div>
            </div>
          </div>
          <div className="acard" style={{ marginTop: 16 }}><div className="acard-h"><h3>Steadfast FREE Fraud Check</h3>
            <span className={"risk-badge " + (g.courier?.stfEmail ? "risk-LOW" : "risk-HIGH")}>{g.courier?.stfEmail ? "CONFIGURED" : "NOT CONFIGURED"}</span>
          </div>
            <div className="acard-b form-grid">
              <div className="af"><label>Steadfast merchant web email (portal.packzy.com login)</label><input value={g.courier?.stfEmail || ""} onChange={(e) => setG({ ...g, courier: { ...g.courier, stfEmail: e.target.value } })} autoCapitalize="none" /></div>
              <div className="af"><label>Steadfast web password</label><input type="password" value={g.courier?.stfPassword || ""} onChange={(e) => setG({ ...g, courier: { ...g.courier, stfPassword: e.target.value } })} autoCapitalize="none" /></div>
              <div className="full" style={{ fontSize: 12, color: "var(--muted)" }}>
                Steadfast merchant dashboard-er <b>free</b> fraud check — order page-e "Courier Fraud Check" card e Steadfast delivery history (delivered/cancelled) FREE dekhabe. Api-key lagbe na, shudhu web login.
              </div>
              <div className="full">{saveBtn("courier")}</div>
            </div>
          </div>
          <div className="acard" style={{ marginTop: 16 }}><div className="acard-h"><h3>Courier Fraud Check — All couriers (FraudBD, optional paid)</h3>
            <span className={"risk-badge " + (g.courier?.fraudApiKey ? "risk-LOW" : "risk-HIGH")}>{g.courier?.fraudApiKey ? "CONFIGURED" : "NOT CONFIGURED"}</span>
          </div>
            <div className="acard-b form-grid">
              <div className="af"><label>Provider name</label><input value={g.courier?.fraudProviderName || ""} onChange={(e) => setG({ ...g, courier: { ...g.courier, fraudProviderName: e.target.value } })} placeholder="FraudBD" /></div>
              <div className="af"><label>Check API URL</label><input value={g.courier?.fraudApiUrl || ""} onChange={(e) => setG({ ...g, courier: { ...g.courier, fraudApiUrl: e.target.value } })} placeholder="https://fraudbd.com/api/check-courier-info" autoCapitalize="none" /></div>
              <div className="af full"><label>API Key</label><input type="password" value={g.courier?.fraudApiKey || ""} onChange={(e) => setG({ ...g, courier: { ...g.courier, fraudApiKey: e.target.value } })} placeholder="provider dashboard theke API key" autoCapitalize="none" /></div>
              <div className="full" style={{ fontSize: 12, color: "var(--muted)" }}>
                FraudBD hole: fraudbd.com theke sign up kore API key nin. Key thakle order page-er Courier Fraud Check card e phone diye Steadfast/Pathao/RedX/Paperfly delivery history dekha jabe. Key na thakleo nijer store-er data (delivered/cancel/return) shob somoy dekhabe.
              </div>
              <div className="full">{saveBtn("courier")}</div>
            </div>
          </div>
          <div className="acard" style={{ marginTop: 16 }}><div className="acard-h"><h3>Fraud Blacklist</h3></div>
            <div className="acard-b">
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <select value={bl.type} onChange={(e) => setBl({ ...bl, type: e.target.value })} className="abtn"><option>PHONE</option><option>ADDRESS</option><option>IP</option></select>
                <input placeholder="Value to blacklist" value={bl.value} onChange={(e) => setBl({ ...bl, value: e.target.value })} style={{ flex: 1, border: "1px solid #d0d5dd", padding: "9px 12px", borderRadius: 5 }} />
                <button className="abtn primary" onClick={blacklistAdd}>Blacklist</button>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Orders from blacklisted phones/IPs/addresses are rejected or flagged automatically.</div>
            </div>
          </div>
        </>
      )}

      {tab === "Checkout & Fraud" && (
        <div className="adm-split adm-split-even" style={{ marginBottom: 0 }}>
          <div className="acard"><div className="acard-h"><h3>Checkout</h3></div>
            <div className="acard-b">
              <label style={{ display: "flex", gap: 8, fontSize: 13.5, padding: "6px 0" }}><input type="checkbox" checked={!!g.checkout?.codEnabled} onChange={(e) => setG({ ...g, checkout: { ...g.checkout, codEnabled: e.target.checked } })} /> Cash on Delivery enabled</label>
              <label style={{ display: "flex", gap: 8, fontSize: 13.5, padding: "6px 0" }}><input type="checkbox" checked={!!g.checkout?.onlinePaymentEnabled} onChange={(e) => setG({ ...g, checkout: { ...g.checkout, onlinePaymentEnabled: e.target.checked } })} /> Online payment enabled (needs gateway — bKash/Nagad/SSLCommerz, add keys in .env)</label>
              <div style={{ marginTop: 12 }}>{saveBtn("checkout")}</div>
            </div>
          </div>
          <div className="acard"><div className="acard-h"><h3>Fraud Protection</h3></div>
            <div className="acard-b form-grid">
              <label className="full" style={{ display: "flex", gap: 8, fontSize: 13.5 }}><input type="checkbox" checked={!!g.fraud?.enabled} onChange={(e) => setG({ ...g, fraud: { ...g.fraud, enabled: e.target.checked } })} /> Enabled</label>
              <F k="velocityMaxOrders" label="Auto-block: orders in window (e.g. 9)" type="number" group="fraud" />
              <F k="velocityWindowMinutes" label="Window (minutes, e.g. 10)" type="number" group="fraud" />
              <div className="af"><label>Auto-block action</label>
                <div style={{ display: "grid", gap: 6, fontSize: 13, paddingTop: 4 }}>
                  <span style={{ color: "var(--muted)" }}>Threshold cross korle IP automatic blacklist + order reject hoy ✓</span>
                  <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={!!g.fraud?.autoBlacklistPhone} onChange={(e) => setG({ ...g, fraud: { ...g.fraud, autoBlacklistPhone: e.target.checked } })} /> Phone-o auto-blacklist korun (strict)</label>
                </div>
              </div>
              <F k="maxOrdersPerHourPerPhone" label="Max orders/hour per phone (hold)" type="number" group="fraud" />
              <F k="highRiskCancelCount" label="Cancellations before HIGH risk" type="number" group="fraud" />
              <div className="full">{saveBtn("fraud")}</div>
            </div>
          </div>
        </div>
      )}

      {tab === "Notifications" && (
        <>
          <div className="noti ok">🔔 In-app notification (bell icon) <b>always on</b> — order place/confirm/cancel shob admin panel-e dekhabe. Telegram setup korle notification <b>apnar phone-e</b> jabe.</div>
          <div className="acard"><div className="acard-h"><h3>Telegram Notifications</h3>
            <span className={"risk-badge " + (g.notifications?.telegramBotToken ? "risk-LOW" : "risk-HIGH")}>{g.notifications?.telegramBotToken ? "CONFIGURED" : "NOT CONFIGURED"}</span>
          </div>
          <div className="acard-b form-grid">
            <label className="full" style={{ display: "flex", gap: 8, fontSize: 13.5, alignItems: "center" }}>
              <input type="checkbox" checked={g.notifications?.enabled !== false} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, enabled: e.target.checked } })} /> Order notifications enabled
            </label>
            <div className="af full"><label>Telegram Bot Token</label>
              <input value={g.notifications?.telegramBotToken || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, telegramBotToken: e.target.value } })} placeholder="123456:ABC-DEF… (@BotFather theke)" autoCapitalize="none" />
            </div>
            <div className="af"><label>Your Chat ID</label>
              <input value={g.notifications?.telegramChatId || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, telegramChatId: e.target.value } })} placeholder="e.g. 987654321 (@userinfobot theke)" />
            </div>
            <div className="af">
              <label>Events</label>
              <div style={{ display: "grid", gap: 6, fontSize: 13.5, paddingTop: 4 }}>
                <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={g.notifications?.order_placed !== false} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, order_placed: e.target.checked } })} /> Order placed (pending)</label>
                <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={g.notifications?.order_confirmed !== false} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, order_confirmed: e.target.checked } })} /> Order confirmed</label>
                <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={g.notifications?.order_cancelled !== false} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, order_cancelled: e.target.checked } })} /> Order cancelled</label>
                <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={g.notifications?.order_delivered !== false} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, order_delivered: e.target.checked } })} /> Order delivered</label>
              </div>
            </div>
            <div className="full" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="abtn primary" onClick={() => save("notifications", g.notifications)} disabled={busy}>Save Notifications</button>
              <TestNotifBtn />
            </div>
            <div className="full" style={{ fontSize: 12, color: "var(--muted)" }}>
              Setup: Telegram-e <b>@BotFather</b>-te /newbot → token nin → bot-e ekta message pathan → <b>api.telegram.org/bot&lt;token&gt;/getUpdates</b> theke chat_id nin.
            </div>
          </div></div>
          <div className="acard" style={{ marginTop: 16 }}><div className="acard-h"><h3>Email Notifications (SMTP)</h3>
            <span className={"risk-badge " + (g.notifications?.notifyEmail && g.notifications?.smtp?.host ? "risk-LOW" : "risk-HIGH")}>{g.notifications?.smtp?.host ? "CONFIGURED" : "NOT CONFIGURED"}</span>
          </div>
          <div className="acard-b form-grid">
            <div className="af full"><label>Notification email (kon email-e admin alert jabe)</label>
              <input value={g.notifications?.notifyEmail || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, notifyEmail: e.target.value } })} placeholder="owner@example.com" />
            </div>
            <div className="af"><label>SMTP Host</label><input value={g.notifications?.smtp?.host || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, smtp: { ...g.notifications?.smtp, host: e.target.value } } })} placeholder="smtp.gmail.com" /></div>
            <div className="af"><label>SMTP Port</label><input type="number" value={g.notifications?.smtp?.port || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, smtp: { ...g.notifications?.smtp, port: e.target.value } } })} placeholder="587" /></div>
            <div className="af"><label>SMTP User</label><input value={g.notifications?.smtp?.user || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, smtp: { ...g.notifications?.smtp, user: e.target.value } } })} autoCapitalize="none" /></div>
            <div className="af"><label>SMTP Password / App password</label><input type="password" value={g.notifications?.smtp?.pass || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, smtp: { ...g.notifications?.smtp, pass: e.target.value } } })} /></div>
            {/* WhatsApp hidden (lib/features.ts) — auto-reply field */}
{FEATURES.adminWhatsapp && (<>
  <div className="af full"><label>WhatsApp auto-reply (first message er jonno, optional)</label>
                <input value={g.notifications?.waAutoReply || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, waAutoReply: e.target.value } })} placeholder="Assalamu alaikum {name}! TRENDING'S te message pathanor jonno dhonnobad — apnar order niye help lagle likhun." />
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Kono customer prothom bar WhatsApp korle ei text ta auto pathano hobe (bridge linked thakle).</div>
              </div>
</>)}
          {/* WhatsApp hidden (lib/features.ts) — broadcast/queue/devices card */}
{FEATURES.adminWhatsapp && (<>
  <div className="acard" style={{ marginTop: 16 }}>
              <div className="acard-h"><h3>WhatsApp broadcast &amp; devices</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>queue · caps · templates</span></div>
              <div className="acard-b" style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 8 }}>
                <div>
                  Order-confirm, 2–3 number-er device manager, QR pairing, daily caps, quiet hours, retry + SMS fallback —
                  shob ek jaygay. Kono message web request-er vitore jay na: order hole row queue-te joma hoy,
                  <code> npm run wa:worker </code> seta pathay.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a className="abtn" href="/admin/whatsapp">Broadcast &amp; Queue</a>
                  <a className="abtn" href="/admin/whatsapp/devices">Devices</a>
                  <a className="abtn" href="/admin/whatsapp/templates">Templates</a>
                </div>
              </div>
            </div>
</>)}
            {/* WhatsApp hidden (lib/features.ts) — bridge key */}
{FEATURES.adminWhatsapp && (<>
  <div className="af full"><label>WhatsApp bridge key (x-bridge-key)</label>
                <input value={g.notifications?.waBridgeKey || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, waBridgeKey: e.target.value } })} placeholder="local-bridge" autoCapitalize="none" />
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Bridge chalanor somoy <code>WA_BRIDGE_KEY</code> same rakhte hobe — inbound message ei key diye verify hoy.</div>
              </div>
</>)}
            <div className="af full"><label>From address</label><input value={g.notifications?.smtp?.from || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, smtp: { ...g.notifications?.smtp, from: e.target.value } } })} placeholder="store@example.com" /></div>
            <div className="full" style={{ fontSize: 12, color: "var(--muted)" }}>
              Gmail hole: 2FA on kore <b>App Password</b> nin (account.google.com/apppasswords). Configure korle admin alert + customer order-confirmation email dutoi jabe.
            </div>
            <div className="full"><button className="abtn primary" onClick={() => save("notifications", g.notifications)} disabled={busy}>Save Notifications</button></div>
          </div></div>

{/* SMS hidden (lib/features.ts) — engagement tool */}
{FEATURES.adminEngagement && (<>
            <div className="acard" style={{ marginTop: 16 }}><div className="acard-h"><h3>SMS Gateway (Bangladesh)</h3>
              <span className={"risk-badge " + (g.notifications?.sms?.apiKey ? "risk-LOW" : "risk-HIGH")}>{g.notifications?.sms?.apiKey ? "CONFIGURED" : "NOT CONFIGURED"}</span>
            </div>
            <div className="acard-b form-grid">
              <label className="full" style={{ display: "flex", gap: 8, fontSize: 13.5, alignItems: "center" }}>
                <input type="checkbox" checked={g.notifications?.sms?.enabled !== false} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, sms: { ...g.notifications?.sms, enabled: e.target.checked } } })} /> SMS sending enabled
              </label>
              <div className="af"><label>Gateway</label>
                <select value={g.notifications?.sms?.provider || "bulksmsbd"} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, sms: { ...g.notifications?.sms, provider: e.target.value } } })}>
                  <option value="bulksmsbd">BulkSMSBD (bulksmsbd.net)</option>
                  <option value="greenweb">GreenWeb (greenweb.com.bd)</option>
                  <option value="mimsms">MimSMS</option>
                  <option value="custom">Custom GET URL</option>
                </select>
              </div>
              <div className="af"><label>Sender ID / Mask</label>
                <input value={g.notifications?.sms?.senderId || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, sms: { ...g.notifications?.sms, senderId: e.target.value } } })} placeholder="8809612xxxx" autoCapitalize="none" />
              </div>
              <div className="af full"><label>API key / token</label>
                <input value={g.notifications?.sms?.apiKey || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, sms: { ...g.notifications?.sms, apiKey: e.target.value } } })} placeholder="gateway dashboard theke API key" autoCapitalize="none" />
              </div>
              {g.notifications?.sms?.provider === "custom" && (
                <div className="af full"><label>Custom URL (GET)</label>
                  <input value={g.notifications?.sms?.url || ""} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, sms: { ...g.notifications?.sms, url: e.target.value } } })} placeholder="https://api.example.com/send?key={key}&to={to}&msg={msg}" autoCapitalize="none" />
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>placeholders: {"{key} {sender} {to} {msg}"}</div>
                </div>
              )}
              <div className="af full">
                <label>Auto SMS on status change</label>
                <div style={{ display: "grid", gap: 6, fontSize: 13.5, paddingTop: 4 }}>
                  {[["sms_on_confirmed", "Confirmed"], ["sms_on_packed", "Packed"], ["sms_on_shipped", "Shipped (tracking soho)"], ["sms_on_delivered", "Delivered"], ["sms_on_cancelled", "Cancelled"]].map(([k, l]) => (
                    <label key={k} style={{ display: "flex", gap: 8 }}>
                      <input type="checkbox" checked={g.notifications?.[k] === true} onChange={(e) => setG({ ...g, notifications: { ...g.notifications, [k]: e.target.checked } })} /> {l}
                    </label>
                  ))}
                </div>
              </div>
              <div className="full" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="abtn primary" onClick={() => save("notifications", g.notifications)} disabled={busy}>Save Notifications</button>
                <TestSmsBtn />
              </div>
              <div className="full" style={{ fontSize: 12, color: "var(--muted)" }}>
                BulkSMSBD: dashboard → API → <b>api_key</b>, ar Mask/Sender ID nin. GreenWeb: token nin. MimSMS: ApiKey + SenderId.
                Auto SMS switch on korle order status change hole customer ke SMS jabe (cost per SMS — ei karone default off).
              </div>
            </div></div>
</>)}
{/* Google login hidden (lib/features.ts → googleLogin) */}
{FEATURES.googleLogin && (<>
            <div className="acard" style={{ marginTop: 16 }}><div className="acard-h"><h3>Google (Gmail) Login — Customers</h3>
              <span className={"risk-badge " + (g.integrations?.googleClientId ? "risk-LOW" : "risk-HIGH")}>{g.integrations?.googleClientId ? "CONFIGURED" : "NOT CONFIGURED"}</span>
            </div>
            <div className="acard-b form-grid">
              <div className="af full"><label>Google Client ID</label>
                <input value={g.integrations?.googleClientId || ""} onChange={(e) => setG({ ...g, integrations: { ...g.integrations, googleClientId: e.target.value } })} placeholder="xxxxx.apps.googleusercontent.com" autoCapitalize="none" />
              </div>
              <div className="af full"><label>Google Client Secret</label>
                <input type="password" value={g.integrations?.googleClientSecret || ""} onChange={(e) => setG({ ...g, integrations: { ...g.integrations, googleClientSecret: e.target.value } })} placeholder="GOCSPX-…" autoCapitalize="none" />
              </div>
              <div className="full" style={{ fontSize: 12, color: "var(--muted)" }}>
                Setup (5 min, free): <b>console.cloud.google.com</b> → APIs &amp; Services → Credentials → <b>Create OAuth Client ID</b> (Web application) → Authorized redirect URI e exactly eta din:<br />
                <b style={{ userSelect: "all" }}>{typeof location !== "undefined" ? location.origin : ""}/api/auth/google/callback</b><br />
                Tarpor upore ID + Secret boshiye Save korun. Customer-ra login page-e "Continue with Google" dekhte pabe.
              </div>
              <div className="full"><button className="abtn primary" onClick={() => save("integrations", g.integrations)} disabled={busy}>Save Integrations</button></div>
            </div></div>
</>)}
          {FEATURES.adminWhatsapp && <WhatsAppCard />}
        </>
      )}
      {tab === "SEO & Maintenance" && (
        <div className="adm-split adm-split-even" style={{ marginBottom: 0 }}>
          <div className="acard"><div className="acard-h"><h3>SEO</h3></div>
            <div className="acard-b form-grid">
              <div className="af full"><label>Meta title</label><input value={g.seo?.metaTitle || ""} onChange={(e) => setG({ ...g, seo: { ...g.seo, metaTitle: e.target.value } })} /></div>
              <div className="af full"><label>Meta description</label><textarea style={{ minHeight: 70 }} value={g.seo?.metaDescription || ""} onChange={(e) => setG({ ...g, seo: { ...g.seo, metaDescription: e.target.value } })} /></div>
              <div className="full">{saveBtn("seo")}</div>
            </div>
          </div>
          <div className="acard"><div className="acard-h"><h3>Maintenance Mode</h3></div>
            <div className="acard-b">
              <label style={{ display: "flex", gap: 8, fontSize: 13.5 }}><input type="checkbox" checked={!!g.maintenance?.enabled} onChange={(e) => setG({ ...g, maintenance: { ...g.maintenance, enabled: e.target.checked } })} /> Enable maintenance mode</label>
              <div className="af" style={{ marginTop: 10 }}><label>Message</label><input value={g.maintenance?.message || ""} onChange={(e) => setG({ ...g, maintenance: { ...g.maintenance, message: e.target.value } })} /></div>
              <div style={{ marginTop: 12 }}>{saveBtn("maintenance")}</div>
            </div>
          </div>
        </div>
      )}
      <div style={{ height: 40 }} />
    </>
  );
}
