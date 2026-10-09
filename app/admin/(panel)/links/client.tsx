"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useMemo, useState } from "react";
import { FEATURES } from "@/lib/features";

type Saved = { name: string; url: string; at: string };

const PRESETS: { label: string; source: string; medium: string }[] = [
  { label: "Facebook post", source: "facebook", medium: "social" },
  { label: "Instagram bio/story", source: "instagram", medium: "social" },
  { label: "WhatsApp broadcast", source: "whatsapp", medium: "social" },
  { label: "SMS blast", source: "sms", medium: "sms" },
  { label: "Facebook/Instagram ad", source: "facebook", medium: "cpc" },
  { label: "TikTok", source: "tiktok", medium: "social" },
  { label: "Email newsletter", source: "newsletter", medium: "email" },
];

/* Build a tagged link, copy it, keep the ones worth reusing. The preview IS the link, so there
   is no guessing about what the tag will look like once it is pasted into a caption. */
export default function LinksClient({ siteUrl, products, posts }: { siteUrl: string; products: { title: string; slug: string }[]; posts: { title: string; slug: string }[] }) {
  const [path, setPath] = useState("/");
  const [custom, setCustom] = useState("");
  const [source, setSource] = useState("facebook");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    afetch("/api/admin/links").then((r) => r.json()).then((j) => setSaved(j.saved || [])).catch(() => {});
  }, []);

  const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");
  const target = custom.trim() ? custom.trim() : path;
  const url = useMemo(() => {
    const base = siteUrl.replace(/\/$/, "");
    const p = target.startsWith("http") ? target : base + (target.startsWith("/") ? target : "/" + target);
    const q = new URLSearchParams();
    if (source) q.set("utm_source", clean(source));
    if (medium) q.set("utm_medium", clean(medium));
    if (campaign) q.set("utm_campaign", clean(campaign));
    if (content) q.set("utm_content", clean(content));
    if (term) q.set("utm_term", clean(term));
    return p + (q.toString() ? (p.includes("?") ? "&" : "?") + q.toString() : "");
  }, [siteUrl, target, source, medium, campaign, content, term]);

  const copy = (t: string) => {
    navigator.clipboard?.writeText(t).then(() => setMsg({ text: "Copied ✓", ok: true })).catch(() => setMsg({ text: "Copy failed — select kore copy korun", ok: false }));
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await afetch("/api/admin/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", name: name || campaign || target, url }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: j.error || "Failed", ok: false }); return; }
    setSaved(j.saved || []); setName(""); setMsg({ text: "Link saved ✓", ok: true });
  };

  const del = async (u: string) => {
    const r = await afetch("/api/admin/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", url: u }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setSaved(j.saved || []);
  };

  const waShare = `https://wa.me/?text=${encodeURIComponent("Take a look: " + url)}`;

  return (
    <>
      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, alignItems: "start", marginBottom: 16  }}>
        <div className="acard">
          <div className="acard-h"><h3>Build a link</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>tags lowercase + hyphen hoy</span></div>
          <div className="acard-b">
            <div className="af" style={{ marginBottom: 10 }}>
              <label>Page</label>
              <select value={path} onChange={(e) => { setPath(e.target.value); setCustom(""); }}>
                <option value="/">Home</option>
                <option value="/products">All products</option>
                {products.map((p) => <option key={p.slug} value={`/products/${p.slug}`}>Product — {p.title}</option>)}
                {posts.map((p) => <option key={p.slug} value={`/blog/${p.slug}`}>Blog — {p.title}</option>)}
                <option value="/blog">Blog index</option>
                <option value="/returns">Returns & Exchange</option>
                <option value="/track">Track order</option>
              </select>
            </div>
            <div className="af" style={{ marginBottom: 10 }}>
              <label>or a custom path / full URL</label>
              <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/products/silk-saree?color=red" autoCapitalize="none" />
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {PRESETS.map((p) => (
                <button key={p.label} type="button" className={"abtn sm" + (source === p.source && medium === p.medium ? " primary" : "")}
                  onClick={() => { setSource(p.source); setMedium(p.medium); }}>{p.label}</button>
              ))}
            </div>

            <div className="form-grid">
              <div className="af"><label>utm_source</label><input value={source} onChange={(e) => setSource(e.target.value)} autoCapitalize="none" /></div>
              <div className="af"><label>utm_medium</label><input value={medium} onChange={(e) => setMedium(e.target.value)} autoCapitalize="none" /></div>
              <div className="af"><label>utm_campaign</label><input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="eid-sale" autoCapitalize="none" /></div>
              <div className="af"><label>utm_content (optional)</label><input value={content} onChange={(e) => setContent(e.target.value)} placeholder="carousel-1" autoCapitalize="none" /></div>
              <div className="af"><label>utm_term (optional, ads)</label><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="jamdani-saree" autoCapitalize="none" /></div>
              <div className="af"><label>Save as</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Eid sale — FB post" /></div>
            </div>

            <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>Your link</div>
              <code style={{ fontSize: 12.5, wordBreak: "break-all" }}>{url}</code>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="abtn primary" onClick={() => copy(url)}>Copy link</button>
                <a className="abtn" href={url} target="_blank" rel="noreferrer">Open</a>
                {FEATURES.adminWhatsapp && <a className="abtn" href={waShare} target="_blank" rel="noreferrer">Share on WhatsApp</a>}
                <button className="abtn" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
              </div>
            </div>

            {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ marginTop: 12 }}>{msg.text}</div>}
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Saved links</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{saved.length} ta</span></div>
          <div className="acard-b" style={{ maxHeight: 520, overflow: "auto" }}>
            {saved.length === 0 ? <div style={{ color: "var(--muted)" }}>Ekhono kichu save kora hoy ni — ekhon ekta link baniye “Save” chapun.</div> : saved.map((l) => (
              <div key={l.url} style={{ padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 13, flex: 1 }}>{l.name}</b>
                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(l.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
                <code style={{ fontSize: 11.5, color: "var(--muted)", wordBreak: "break-all", display: "block" }}>{l.url}</code>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button className="abtn sm" onClick={() => copy(l.url)}>Copy</button>
                  <a className="abtn sm" href={l.url} target="_blank" rel="noreferrer">Open</a>
                  <button className="abtn sm" onClick={() => del(l.url)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
