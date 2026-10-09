"use client";
import { afetch, withToken } from "@/lib/afetch";
import { FEATURES } from "@/lib/features";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type V = { id?: number; size: string; color: string; sku: string; price: string; stock: string };
type P = any;

/* Linked color-variant image cell: upload (or paste URL) an image for this
   variant; selecting that color on the PDP shows this image first. */
function VariantImgCell({ v, i, setEdit }: { v: any; i: number; setEdit: any }) {
  const [up, setUp] = useState(false);
  const setImg = (url: string) => {
    setEdit((e: any) => { const vs = [...e.variants]; vs[i] = { ...v, image: url }; return { ...e, variants: vs }; });
  };
  if (!FEATURES.colorGroups) return <div aria-hidden />;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {v.image ? (
        <div style={{ position: "relative" }}>
          <img src={v.image} alt="" style={{ width: 30, height: 38, objectFit: "cover", borderRadius: 3, border: "1px solid #ddd" }} />
          <button type="button" title="Remove image" onClick={() => setImg("")} style={{ position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 10, cursor: "pointer" }}>✕</button>
        </div>
      ) : null}
      <label className="abtn sm" style={{ cursor: "pointer" }} title="Upload color image">
        {up ? "…" : "⬆"}
        <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setUp(true);
          try {
            const fd = new FormData(); fd.append("file", f);
            const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
            const j = await r.json();
            if (j.url) setImg(j.url); else alert(j.error || "Upload failed");
          } catch { alert("Upload failed"); }
          setUp(false);
        }} />
      </label>
    </div>
  );
}

const EMPTY: any = { title: "", slug: "", shortDesc: "", description: "", sku: "", price: "", comparePrice: "", cost: "", stock: "0", lowStock: "5", soldCount: "", saleEnds: "", status: "ACTIVE", featured: false, isNew: false, isBestSeller: false, badge: '', sizeChartImage: "", tags: "", categoryId: "", images: [], variants: [], colorGroupId: "", colorName: "", colorImage: "", preorder: false, preorderDate: "", soldMode: "fixed" };
function DescriptionEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after: string) => {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e) || "text";
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; }, 0);
  };
  const linePrefix = (prefix: string) => {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + prefix.length; }, 0);
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button type="button" className="abtn sm" title="Bold" onClick={() => wrap("**", "**")}><b>B</b></button>
        <button type="button" className="abtn sm" title="Italic" onClick={() => wrap("_", "_")}><i>I</i></button>
        <button type="button" className="abtn sm" title="Large text" onClick={() => wrap("## ", "")} style={{ fontWeight: 700, fontSize: 14 }}>H</button>
        <button type="button" className="abtn sm" title="Small text" onClick={() => wrap("~~", "~~")} style={{ fontSize: 11 }}>small</button>
        <button type="button" className="abtn sm" title="Bullet point" onClick={() => linePrefix("• ")}>• List</button>
        <button type="button" className="abtn sm" title="Tick point" onClick={() => linePrefix("✓ ")}>✓ Tick</button>
      </div>
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 130, fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        <b>**text**</b> = bold · <b>## text</b> = large heading · <b>_text_</b> = italic · <b>~~text~~</b> = small · <b>• / ✓</b> = list items (product page-e auto style hobe)
      </div>
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9\u0980-\u09FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export default function ProductsClient({ initial, categories }: { initial: P[]; categories: { id: number; name: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<any | null>(null);
  const [colorGroups, setColorGroups] = useState<any[]>([]);

  const loadColorGroups = () => {
    if (!FEATURES.colorGroups) return;
    afetch("/api/admin/color-groups")
      .then((r) => r.json())
      .then((j) => setColorGroups(j.groups || []))
      .catch(() => {});
  };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<P[]>(initial);
  const [dragId, setDragId] = useState<number | null>(null);
  useEffect(() => { setItems(initial); }, [initial]);
  const list = useMemo(() => items.filter((p) => !q || (p.title + p.sku + p.tags).toLowerCase().includes(q.toLowerCase())), [items, q]);

  const persistOrder = async (next: P[]) => {
    setItems(next);
    try {
      const r = await afetch("/api/admin/products/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: next.map((p) => p.id) }) });
      if (r.ok) { setMsg("✓ Order saved — homepage/listing-e dekhabe"); router.refresh(); }
      else { const j = await r.json(); setMsg(j.error || "Reorder failed"); }
    } catch { setMsg("Network error"); }
    setTimeout(() => setMsg(""), 2500);
  };
  const move = (fromId: number | null, toId: number) => {
    if (fromId == null || fromId === toId) return;
    const next = [...items];
    const fi = next.findIndex((p) => p.id === fromId);
    const ti = next.findIndex((p) => p.id === toId);
    if (fi < 0 || ti < 0) return;
    const [m] = next.splice(fi, 1);
    next.splice(ti, 0, m);
    persistOrder(next);
  };
  const moveBy = (id: number, d: number) => {
    const i = items.findIndex((p) => p.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    persistOrder(next);
  };

  const openNew = () => { setSlugTouched(false); setEdit({ ...EMPTY }); loadColorGroups(); };
  const openEdit = (p: P) => {
    setSlugTouched(true);
    loadColorGroups();
    // Map old isNew/isBestSeller to badge for backwards compatibility
    const badge = p.badge || (p.isBestSeller ? "hot" : p.isNew ? "new" : "");
    setEdit({
      ...EMPTY, ...p, badge,
    price: String(p.price), comparePrice: p.comparePrice != null ? String(p.comparePrice) : "",
    cost: p.cost != null ? String(p.cost) : "", stock: String(p.stock), lowStock: String(p.lowStock),
    soldCount: p.soldCount != null ? String(p.soldCount) : "",
    saleEnds: p.saleEnds ? new Date(p.saleEnds).toISOString().slice(0, 16) : "",
    preorder: !!p.preorder, preorderDate: p.preorderDate ? new Date(p.preorderDate).toISOString().slice(0, 10) : "",
    soldMode: p.soldMode || "fixed",
    colorGroupId: p.colorGroupId != null ? String(p.colorGroupId) : "",
    colorName: p.colorName || "",
    // auto: color thumbnail defaults to the product's main image (admin can replace/remove)
    colorImage: p.colorImage || (p.images && p.images[0] ? p.images[0].url : ""),
    variants: p.variants.map((v: any) => ({ ...v, size: v.size || "", color: v.color || "", sku: v.sku || "", price: v.price != null ? String(v.price) : "", stock: String(v.stock), image: v.image || "" })),
  }); };

  const genVariants = (kind: "alpha" | "numeric") => {
    const sizes = kind === "alpha" ? ["S", "M", "L", "XL", "XXL"] : ["28", "30", "32", "34", "36", "38", "40"];
    setEdit((e: any) => ({
      ...e,
      variants: sizes.map((s) => ({
        size: s,
        color: (e.variants || [])[0]?.color || "",
        sku: (e.sku ? e.sku + "-" : "") + s,
        price: (e.variants || [])[0]?.price || "",
        stock: (e.variants || [])[0]?.stock || "10",
      })),
    }));
  };

  const upload = async (files: FileList) => {
    setBusy(true); setMsg("Uploading " + files.length + " image(s)…");
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append("file", file);
      const r = await afetch("/api/admin/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok) urls.push(j.url); else alert(j.error || "Upload failed: " + file.name);
    }
    if (urls.length) {
      setEdit((e: any) => ({
        ...e,
        images: [...e.images, ...urls],
        // first gallery image doubles as the color swatch until admin sets/removes it
        colorImage: e.colorImage || (e.images.length === 0 ? urls[0] : e.colorImage),
      }));
      setMsg(urls.length + " image added ✓"); setTimeout(() => setMsg(""), 2500);
    }
    setBusy(false);
  };
  const uploadChart = async (file: File) => {
    setBusy(true); setMsg("Uploading size chart…");
    const fd = new FormData(); fd.append("file", file); fd.append("mode", "chart");
    const r = await afetch("/api/admin/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (r.ok) { setEdit((e: any) => ({ ...e, sizeChartImage: j.url })); setMsg("Size chart uploaded ✓"); }
    else setMsg(j.error || "Upload failed");
    setBusy(false); setTimeout(() => setMsg(""), 2500);
  };

  const moveImg = (i: number, dir: number) => setEdit((e: any) => {
    const arr = [...e.images]; const j = i + dir;
    if (j < 0 || j >= arr.length) return e;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...e, images: arr };
  });

  const save = async () => {
    if (!edit.title || !edit.price) { alert("Title and price are required"); return; }
    setBusy(true); setMsg("");
    const payload = {
      ...edit,
      price: Number(edit.price), comparePrice: edit.comparePrice ? Number(edit.comparePrice) : null,
      cost: edit.cost ? Number(edit.cost) : null, stock: Number(edit.stock || 0), lowStock: Number(edit.lowStock || 5),
      soldCount: edit.soldCount === "" || edit.soldCount == null ? null : Math.max(0, Number(edit.soldCount)),
      saleEnds: edit.saleEnds ? new Date(edit.saleEnds).toISOString() : null,
      preorder: !!edit.preorder,
      preorderDate: edit.preorderDate ? new Date(edit.preorderDate + "T12:00:00").toISOString() : null,
      soldMode: edit.soldMode === "random" ? "random" : "fixed",
      colorGroupId: edit.colorGroupId ? Number(edit.colorGroupId) : null,
      colorName: edit.colorName ? String(edit.colorName).trim().slice(0, 40) : null,
      colorImage: edit.colorImage || null,
      categoryId: edit.categoryId ? Number(edit.categoryId) : null,
      variants: (edit.variants || []).map((v: any) => ({ ...v, price: v.price ? Number(v.price) : null, stock: Number(v.stock || 0) })),
    };
    const r = await fetch(edit.id ? "/api/admin/products/" + edit.id : "/api/admin/products", {
      method: edit.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (r.ok) { setEdit(null); setMsg(edit.id ? "Product updated ✓" : "Product created ✓"); router.refresh(); }
    else setMsg(j.error || "Save failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 2500);
  };

  const duplicate = async (p: P) => {
    setBusy(true);
    const r = await afetch("/api/admin/products/" + p.id + "/duplicate", { method: "POST" });
    const j = await r.json();
    if (r.ok) { setMsg("✓ Product duplicated as DRAFT — edit & publish it"); router.refresh(); }
    else setMsg(j.error || "Duplicate failed");
    setBusy(false);
    setTimeout(() => setMsg(""), 3000);
  };

  const del = async (p: P) => {
    if (!confirm(`Delete "${p.title}" permanently?`)) return;
    setBusy(true);
    await afetch("/api/admin/products/" + p.id, { method: "DELETE" });
    setBusy(false); router.refresh();
  };
  const exportCsv = () => { window.location.href = withToken("/api/admin/export?type=products"); };

  return (
    <>
      <div className="admin-top">
        <h1>Products <span style={{ fontSize: 14, color: "var(--muted)" }}>({initial.length})</span></h1>
        <div className="admin-actions">
          <button className="abtn" onClick={exportCsv}>⭳ Export CSV</button>
          <button className="abtn primary" onClick={openNew}>+ Add Product</button>
        </div>
      </div>
      {msg && <div className="noti ok">{msg}</div>}
      <input className="asearch" style={{ marginBottom: 14 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>⠿ handle dhore drag korun — order change hole automatic save hoy ar homepage/listing-e sei order dekhabe</div>
      <div className="acard">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th style={{ width: 60 }}>⠿ Order</th><th></th><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Variants</th><th>Status</th><th>Views</th><th></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={10} style={{ color: "var(--muted)", padding: 30 }}>No products yet.</td></tr>}
              {list.map((p, idx) => (
                <tr key={p.id}
                  draggable={q === ""}
                  onDragStart={() => setDragId(p.id)}
                  onDragOver={(e) => { if (q === "") e.preventDefault(); }}
                  onDrop={() => { move(dragId, p.id); setDragId(null); }}
                  style={{ cursor: q === "" ? "grab" : undefined, opacity: dragId === p.id ? 0.5 : 1 }}
                >
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span title="Drag to reorder" style={{ cursor: "grab", fontSize: 16, color: "var(--muted)" }}>⠿</span>
                    <button className="abtn sm" style={{ padding: "1px 6px", margin: "0 2px" }} title="Move up" onClick={() => moveBy(p.id, -1)} disabled={idx === 0}>↑</button>
                    <button className="abtn sm" style={{ padding: "1px 6px" }} title="Move down" onClick={() => moveBy(p.id, 1)} disabled={idx === list.length - 1}>↓</button>
                  </td>
                  <td>{p.image ? <img src={p.image} alt="" /> : <div style={{ width: 40, height: 50, background: "#eee", borderRadius: 4 }} />}</td>
                  <td><b>{p.title}</b><br /><span style={{ color: "var(--muted)", fontSize: 12 }}>{p.categoryName || "Uncategorized"}{p.featured ? " · ★ Featured" : ""}</span></td>
                  <td style={{ fontSize: 12 }}>{p.sku || "—"}</td>
                  <td>৳{p.price.toLocaleString("en-IN")}{p.comparePrice ? <><br /><s style={{ color: "var(--muted)", fontSize: 12 }}>৳{p.comparePrice.toLocaleString("en-IN")}</s></> : null}</td>
                  <td>{p.stock <= p.lowStock ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>{p.stock}</span> : p.stock}</td>
                  <td>{p.variants.length || "—"}</td>
                  <td><span className={"pill " + p.status}>{p.status}</span></td>
                  <td>{p.views}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="abtn sm" onClick={() => openEdit(p)}>Edit</button>{" "}
                    <button className="abtn sm" title="Duplicate product" onClick={() => duplicate(p)}>📋</button>{" "}
                    <button className="abtn sm danger" onClick={() => del(p)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEdit(null)}>×</button>
            <h3>{edit.id ? "Edit Product" : "New Product"}</h3>
            <div className="form-grid">
              <div className="af full"><label>Title *</label>
                <input value={edit.title} onChange={(e) => { const title = e.target.value; setEdit((x: any) => ({ ...x, title, slug: slugTouched ? x.slug : slugify(title) })); }} />
              </div>
              <div className="af full">
                <label>URL / Slug (auto-generates from title)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={edit.slug} onChange={(e) => { setSlugTouched(true); setEdit({ ...edit, slug: slugify(e.target.value) }); }} placeholder="auto-generates…" />
                  <button type="button" className="abtn" title="Auto-generate from title" onClick={() => { setSlugTouched(false); setEdit({ ...edit, slug: slugify(edit.title) }); }}>↻ Auto</button>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>🔗 yourdomain.com/products/<b>{edit.slug || "…"}{edit.id ? "" : " (notun product save korlei live hobe)"}</b></div>
              </div>
              <div className="af"><label>Price (৳) *</label><input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></div>
              <div className="af"><label>Compare-at price (৳)</label><input type="number" value={edit.comparePrice} onChange={(e) => setEdit({ ...edit, comparePrice: e.target.value })} placeholder="Original price for discounts" /></div>
              <div className="af"><label>Cost per item (৳)</label><input type="number" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} placeholder="For profit margin" /></div>
              <div className="af"><label>SKU</label><input value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></div>
              <div className="af"><label>Stock</label><input type="number" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: e.target.value })} /></div>
              <div className="af"><label>Low-stock alert at</label><input type="number" value={edit.lowStock} onChange={(e) => setEdit({ ...edit, lowStock: e.target.value })} /></div>
              <div className="af full"><label>Flash sale countdown (optional)</label>
                <input type="datetime-local" value={edit.saleEnds || ""} onChange={(e) => setEdit({ ...edit, saleEnds: e.target.value })} />
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Compare-at price beshi hole countdown dekhabe (PDP + card e "Sale ends in 2h 34m"). Time hole automatic off.
                </div>
              </div>
{FEATURES.soldCount && (
              <div className="af full"><label>Sold count (product page e "Sold: N" dekhabe)</label>
                <div style={{ display: "flex", gap: 18, marginBottom: 8, fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="soldmode" checked={edit.soldMode !== "random"} onChange={() => setEdit({ ...edit, soldMode: "fixed" })} />
                    Fixed (exact number)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="soldmode" checked={edit.soldMode === "random"} onChange={() => setEdit({ ...edit, soldMode: "random" })} />
                    Random (auto, din boro hoy)
                  </label>
                </div>
                <input type="number" value={edit.soldCount} disabled={edit.soldMode === "random"}
                  onChange={(e) => setEdit({ ...edit, soldCount: e.target.value })} placeholder="khaali = dekhabe na" />
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {edit.soldMode === "random"
                    ? "Random mode e number auto-generated hoy ar bishesh-khon e +1..+3 hoye boro hoy (aj 958 → 961 → 965…). Number field ei mode e ignore hoy."
                    : "Fixed mode e soho ei number dekhabe. Khaali rakhle sold count dekhabe na."}
                </div>
              </div>
              )}
              <div className="af full"><label>Pre-order (stock ashe na, age order nito jay)</label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!edit.preorder} onChange={(e) => setEdit({ ...edit, preorder: e.target.checked })} />
                  <span>Pre-order on koro — stock 0 thakleo customer order dite parbe (stock komabe na)</span>
                </label>
                {edit.preorder && (
                  <>
                    <input type="date" value={edit.preorderDate || ""} onChange={(e) => setEdit({ ...edit, preorderDate: e.target.value })} />
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      PDP e <b>Pre-order</b> badge + "Expected delivery (date)" dekhabe. Admin order list e PRE-ORDER tag thakbe.
                    </div>
                  </>
                )}
              </div>
              <div className="af"><label>Category</label>
                <select value={edit.categoryId} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })}>
                  <option value="">— None —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="af"><label>Status</label>
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option>ACTIVE</option><option>DRAFT</option><option>ARCHIVED</option>
                </select>
              </div>
              <div className="af full"><label>Short description</label><input value={edit.shortDesc} onChange={(e) => setEdit({ ...edit, shortDesc: e.target.value })} /></div>
              <div className="af full">
                <label>Full description (formatting supported)</label>
                <DescriptionEditor value={edit.description || ""} onChange={(v: string) => setEdit({ ...edit, description: v })} />
              </div>
              <div className="af full"><label>Tags (comma separated)</label><input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder="linen, summer, new" /></div>
            </div>

            <div style={{ margin: "16px 0 6px", fontWeight: 600, fontSize: 13.5 }}>Images</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              {edit.images.map((u: string, i: number) => (
                <div key={i} style={{ position: "relative", textAlign: "center" }}>
                  <img src={u} alt="" style={{ width: 64, height: 80, objectFit: "cover", borderRadius: 4, border: i === 0 ? "2px solid var(--text)" : "1px solid #ddd" }} title={i === 0 ? "Main image" : "Image " + (i + 1)} />
                  {i === 0 && <span style={{ position: "absolute", top: 4, left: 4, background: "var(--text)", color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 99 }}>MAIN</span>}
                  <button onClick={() => setEdit({ ...edit, images: edit.images.filter((_: any, x: number) => x !== i) })} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                  <div style={{ display: "flex", gap: 2, marginTop: 4, justifyContent: "center" }}>
                    <button type="button" className="abtn sm" style={{ padding: "2px 8px" }} disabled={i === 0} onClick={() => moveImg(i, -1)}>←</button>
                    <button type="button" className="abtn sm" style={{ padding: "2px 8px" }} disabled={i === edit.images.length - 1} onClick={() => moveImg(i, 1)}>→</button>
                  </div>
                </div>
              ))}
              <button className="abtn" onClick={() => fileRef.current?.click()} type="button">⬆ Upload images</button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
              <div style={{ fontSize: 12, color: "var(--muted)", width: "100%" }}>Ek sathe multiple image select kora jay (Ctrl/Cmd+click) · first image = main product image · ←/→ diye order bodlao</div>
            </div>

            <div className="var-head">
              <span>Variants (size / color / stock)</span>
              <span className="var-head-btns">
                <button className="abtn sm" type="button" title="S M L XL XXL auto-generate" onClick={() => genVariants("alpha")}>Auto S–XXL</button>
                <button className="abtn sm" type="button" title="28–40 numeric sizes auto-generate" onClick={() => genVariants("numeric")}>Auto 28–40</button>
                <button className="abtn sm" type="button" onClick={() => setEdit({ ...edit, variants: [...(edit.variants || []), { size: "", color: "", sku: "", price: "", stock: "0" }] })}>+ Add</button>
              </span>
            </div>
            {(edit.variants || []).map((v: any, i: number) => (
              <div key={i} className="var-row">
                <input placeholder="Size" aria-label={"Variant " + (i + 1) + " size"} value={v.size} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, size: e.target.value }; setEdit({ ...edit, variants: vs }); }} />
                <input placeholder="Color" aria-label={"Variant " + (i + 1) + " color"} value={v.color} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, color: e.target.value }; setEdit({ ...edit, variants: vs }); }} />
                <input placeholder="SKU" aria-label={"Variant " + (i + 1) + " SKU"} value={v.sku} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, sku: e.target.value }; setEdit({ ...edit, variants: vs }); }} />
                <input placeholder="Price" aria-label={"Variant " + (i + 1) + " price"} type="number" inputMode="decimal" value={v.price} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, price: e.target.value }; setEdit({ ...edit, variants: vs }); }} />
                <input placeholder="Stock" aria-label={"Variant " + (i + 1) + " stock"} type="number" inputMode="numeric" value={v.stock} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, stock: e.target.value }; setEdit({ ...edit, variants: vs }); }} />
                {/* linked color image: oi color select korle PDP gallery ei image dekhabe */}
                <VariantImgCell v={v} i={i} setEdit={setEdit} />
                <button className="abtn sm danger var-del" type="button" aria-label={"Remove variant " + (i + 1)} onClick={() => setEdit({ ...edit, variants: edit.variants.filter((_: any, x: number) => x !== i) })}>✕</button>
              </div>
            ))}

            {/* ---- COLOR GROUP (linked color products) ---- */}
            {FEATURES.colorGroups && (
            <div className="af full" style={{ marginTop: 18, borderTop: "1px solid #e4e7ec", paddingTop: 14 }}>
              <label style={{ fontWeight: 600, fontSize: 13.5 }}>Color Group (linked color products)</label>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
                Ek rokom product er different color alada product hishebe thakbe (alada URL, stock, size) — kintu product page e circular color thumbnail diye linked thakbe. Khali rakhle kono link hobe na.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <select
                  value={edit.colorGroupId || ""}
                  onChange={(e) => setEdit({ ...edit, colorGroupId: e.target.value })}
                >
                  <option value="">— No color group (standalone) —</option>
                  {(colorGroups || []).map((cg: any) => (
                    <option key={cg.id} value={String(cg.id)}>{cg.name} ({(cg.products || []).length} color{((cg.products || []).length) === 1 ? "" : "s"})</option>
                  ))}
                </select>
                <button type="button" className="abtn" onClick={() => {
                  const name = prompt("Notun color group er naam din (e.g. Double Vest Khadi Shirt):");
                  if (!name || name.trim().length < 2) return;
                  fetch("/api/admin/color-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) })
                    .then((r) => r.json())
                    .then((j) => {
                      if (!j.group) { alert(j.error || "Failed"); return; }
                      setColorGroups((cur: any[]) => [{ ...j.group, products: [] }, ...(cur || [])]);
                      setEdit((e: any) => ({ ...e, colorGroupId: String(j.group.id) }));
                      alert("Color group created ✓ — ekhon ei group er onno product gulote same group select korun.");
                    })
                    .catch(() => alert("Failed"));
                }}>+ New group</button>
              </div>
              {edit.colorGroupId && (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)" }}>This product's color label (thumbnail er niche / alt text e dekhabe)</label>
                    <input value={edit.colorName || ""} onChange={(e) => setEdit({ ...edit, colorName: e.target.value })} placeholder="e.g. Black" style={{ width: "100%", marginTop: 4 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)" }}>Color thumbnail (circular swatch)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      {edit.colorImage ? (
                        <div style={{ position: "relative" }}>
                          <img src={edit.colorImage} alt="" style={{ width: 44, height: 44, borderRadius: 99, objectFit: "cover", border: "2px solid #ddd" }} />
                          <button type="button" onClick={() => setEdit({ ...edit, colorImage: "" })} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                        </div>
                      ) : <div style={{ width: 44, height: 44, borderRadius: 99, border: "1px dashed #ccc" }} />}
                      <label className="abtn sm" style={{ cursor: "pointer" }}>
                        ⬆ Upload
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            const fd = new FormData(); fd.append("file", f);
                            const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
                            const j = await r.json();
                            if (j.url) setEdit({ ...edit, colorImage: j.url }); else alert(j.error || "Upload failed");
                          } catch { alert("Upload failed"); }
                        }} />
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {edit.colorGroupId && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>
                  {(colorGroups || []).find((cg: any) => String(cg.id) === String(edit.colorGroupId))?.products?.length
                    ? "Linked products: " + (colorGroups || []).find((cg: any) => String(cg.id) === String(edit.colorGroupId))!.products.map((pp: any) => pp.colorName || pp.title).join(", ")
                    : "Ei group e ekhono onno product nai — onno color product gulote ei group select korlei linked hobe."}
                </div>
              )}
            </div>
            )}

            <div className="af full" style={{ marginTop: 16 }}>
              <label>Size chart image (optional — product page-er "Size chart" button e dekhabe)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {edit.sizeChartImage ? (
                  <div style={{ position: "relative" }}>
                    <img src={edit.sizeChartImage} alt="" style={{ maxHeight: 90, borderRadius: 4, border: "1px solid #ddd" }} />
                    <button type="button" onClick={() => setEdit({ ...edit, sizeChartImage: "" })} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                ) : null}
                <label className="abtn" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  ⬆ Upload size chart
                  <input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) uploadChart(e.target.files[0]); e.target.value = ""; }} />
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
              <div className="af" style={{ minWidth: 200 }}>
                <label>Badge</label>
                <select value={edit.badge || ""} onChange={(e) => setEdit({ ...edit, badge: e.target.value })}>
                  <option value="">No Badge</option>
                  <option value="trending">TRENDING NOW</option>
                  <option value="hot">HOT PICK</option>
                  <option value="new">NEW</option>
                  <option value="signature">SIGNATURE</option>
                  <option value="limited">LIMITED</option>
                </select>
              </div>
              <span style={{ flex: 1 }} />
              <button className="abtn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="abtn primary" onClick={save} disabled={busy} aria-busy={busy || undefined}>{busy && <span className="spinner" aria-hidden="true" />} {busy ? "Saving…" : "Save Product"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
