"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CatalogClient({ categories, collections, products }: any) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [newCat, setNewCat] = useState({ name: "", description: "", image: "" });
  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editCatImg, setEditCatImg] = useState("");

  const uploadCatImg = async (file: File, catId?: number) => {
    const fd = new FormData(); fd.append("file", file);
    setMsg("Uploading…");
    try {
      const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { setMsg("Upload failed" + (j.error ? " — " + j.error : " (" + r.status + ")")); setTimeout(() => setMsg(""), 3000); return; }
      if (catId) {
        const p = await fetch("/api/admin/categories/" + catId, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: j.url }) });
        const pj = await p.json().catch(() => ({}));
        if (!p.ok) { setMsg("Image saved, but category update failed" + (pj.error ? " — " + pj.error : " (" + p.status + ")")); setTimeout(() => setMsg(""), 3000); return; }
        setMsg("Category image updated ✓"); router.refresh();
        setTimeout(() => setMsg(""), 2500);
      } else {
        setNewCat((c) => ({ ...c, image: j.url }));
        setMsg("Image uploaded — now press Add ✓"); setTimeout(() => setMsg(""), 2500);
      }
    } catch {
      setMsg("Upload failed — network error (try a smaller image)");
      setTimeout(() => setMsg(""), 3000);
    }
  };

  const [newCol, setNewCol] = useState({ title: "", subtitle: "", productIds: [] as number[] });

  // edit-collection modal state
  const [editCol, setEditCol] = useState<any>(null); // { id, title, subtitle, productIds[] }
  const [colBusy, setColBusy] = useState(false);
  const [colSearch, setColSearch] = useState("");

  const openEditCol = (c: any) => {
    setEditCol({ id: c.id, title: c.title, subtitle: c.subtitle || "", productIds: [...(c.productIds || [])] });
    setColSearch("");
  };
  const toggleProduct = (pid: number) => {
    setEditCol((ec: any) => ({
      ...ec,
      productIds: ec.productIds.includes(pid) ? ec.productIds.filter((x: number) => x !== pid) : [...ec.productIds, pid],
    }));
  };

  const api = async (url: string, method: string, body?: any) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (r.ok) { setMsg("Saved ✓"); router.refresh(); } else setMsg(j.error || "Failed");
    setTimeout(() => setMsg(""), 2200);
    return j;
  };

  const saveCollection = async () => {
    if (!editCol) return;
    setColBusy(true);
    await api("/api/admin/collections/" + editCol.id, "PUT", {
      title: editCol.title,
      subtitle: editCol.subtitle,
      productIds: editCol.productIds,
    });
    setColBusy(false);
    setEditCol(null);
  };

  const filteredProducts = products.filter((p: any) =>
    !colSearch || p.title.toLowerCase().includes(colSearch.toLowerCase())
  );

  return (
    <>
      <div className="admin-top"><h1>Categories &amp; Collections</h1></div>
      {msg && <div className="noti ok">{msg}</div>}
      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start"  }}>
        {/* CATEGORIES */}
        <div className="acard">
          <div className="acard-h"><h3>Categories ({categories.length})</h3></div>
          <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Slug</th><th>Products</th><th></th></tr></thead>
            <tbody>
              {categories.map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {c.image
                        ? <img src={c.image.startsWith("/api/media") ? c.image + "/w80" : c.image} width={30} height={30} alt="" style={{ borderRadius: 4, objectFit: "cover", background: "#eee" }} />
                        : <div style={{ width: 30, height: 30, borderRadius: 4, background: "rgba(122,152,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🖼</div>}
                      <b>{c.name}</b>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>/{c.slug}</td>
                  <td>{c.productCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="abtn sm" title="Upload category image" onClick={() => { setEditCatId(editCatId === c.id ? null : c.id); setEditCatImg(""); }}>🖼</button>{" "}
                    <button className="abtn sm danger" onClick={() => confirm("Delete " + c.name + "?") && api("/api/admin/categories/" + c.id, "DELETE")}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="acard-b" style={{ borderTop: "1px solid #e4e7ec" }}>
            {editCatId && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: "rgba(122,152,255,.07)", border: "1px solid rgba(122,152,255,.16)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Upload image for "{categories.find((c) => c.id === editCatId)?.name || "#" + editCatId}"</div>
                  <button className="abtn sm" onClick={() => setEditCatId(null)}>✕ Close</button>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {categories.find((c) => c.id === editCatId)?.image ? (
                    <img src={(() => { const u = categories.find((c) => c.id === editCatId)?.image || ""; return u.startsWith("/api/media") ? u + "/w80" : u; })()} alt="" style={{ width: 50, height: 50, borderRadius: 6, objectFit: "cover", border: "1px solid #ddd" }} />
                  ) : (
                    <div style={{ width: 50, height: 50, borderRadius: 6, background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🖼</div>
                  )}
                  <label className="abtn primary sm" style={{ cursor: "pointer" }}>
                    ⬆ Choose image
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) uploadCatImg(e.target.files[0], editCatId); }} />
                  </label>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input placeholder="New category name" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} style={{ flex: 1, border: "1px solid #d0d5dd", padding: "9px 12px", borderRadius: 5 }} />
              <button className="abtn primary" onClick={async () => { if (newCat.name) { await api("/api/admin/categories", "POST", { ...newCat, image: newCat.image || undefined }); setNewCat({ name: "", description: "", image: "" }); } }}>Add</button>
            </div>
          </div>
        </div>
        {/* COLLECTIONS */}
        <div className="acard">
          <div className="acard-h"><h3>Collections ({collections.length})</h3></div>
          <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Collection</th><th>Slug</th><th>Products</th><th></th></tr></thead>
            <tbody>
              {collections.map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.title}</b><br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{c.subtitle}</span></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>/{c.slug}</td>
                  <td>{c.productCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="abtn sm" title="Edit collection — add/remove products" onClick={() => openEditCol(c)}>✏️</button>{" "}
                    <button className="abtn sm danger" onClick={() => confirm("Delete " + c.title + "?") && api("/api/admin/collections/" + c.id, "DELETE")}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="acard-b" style={{ borderTop: "1px solid #e4e7ec" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Collection title (e.g. Best Sellers)" value={newCol.title} onChange={(e) => setNewCol({ ...newCol, title: e.target.value })} style={{ flex: 1, border: "1px solid #d0d5dd", padding: "9px 12px", borderRadius: 5 }} />
                <button className="abtn primary" onClick={async () => { if (newCol.title) { await api("/api/admin/collections", "POST", newCol); setNewCol({ title: "", subtitle: "", productIds: [] }); } }}>Add</button>
              </div>
              <select multiple value={newCol.productIds.map(String)} onChange={(e) => setNewCol({ ...newCol, productIds: Array.from(e.target.selectedOptions).map((o) => Number(o.value)) })} style={{ height: 110, border: "1px solid #d0d5dd", borderRadius: 5, padding: 8, fontSize: 13 }}>
                {products.map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Hold Ctrl/Cmd to select multiple products for this new collection. Notun collection banale Featured Collection dropdown-e auto add hobe.</div>
            </div>
          </div>
        </div>
      </div>

      {/* EDIT COLLECTION MODAL */}
      {editCol && (
        <div className="modal-bg" onClick={() => setEditCol(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditCol(null)} aria-label="Close">×</button>
            <h3>Edit Collection</h3>
            <div className="form-grid">
              <div className="af"><label>Title</label>
                <input value={editCol.title} onChange={(e) => setEditCol({ ...editCol, title: e.target.value })} />
              </div>
              <div className="af"><label>Subtitle</label>
                <input value={editCol.subtitle} onChange={(e) => setEditCol({ ...editCol, subtitle: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 8px" }}>
              <b style={{ fontSize: 13.5 }}>Products in this collection: {editCol.productIds.length}</b>
              <input placeholder="🔍 Search products…" value={colSearch} onChange={(e) => setColSearch(e.target.value)} style={{ border: "1px solid #d0d5dd", padding: "7px 10px", borderRadius: 5, fontSize: 13, width: 200 }} />
            </div>
            <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #e8e6e1", borderRadius: 6 }}>
              {filteredProducts.map((p: any) => {
                const on = editCol.productIds.includes(p.id);
                return (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid #f0f2f5", cursor: "pointer", background: on ? "#f6f9f4" : "#fff" }}>
                    <input type="checkbox" checked={on} onChange={() => toggleProduct(p.id)} style={{ width: 16, height: 16 }} />
                    <span style={{ fontSize: 13.5 }}>{p.title}</span>
                    {on && <span className="pill DELIVERED" style={{ marginLeft: "auto" }}>IN</span>}
                  </label>
                );
              })}
              {filteredProducts.length === 0 && <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>No product matches “{colSearch}”.</div>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="abtn" onClick={() => setEditCol(null)}>Cancel</button>
              <button className="abtn primary" onClick={saveCollection} disabled={colBusy} aria-busy={colBusy || undefined}>
                {colBusy && <span className="spinner" aria-hidden="true" />} {colBusy ? "Saving…" : "Save Collection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
