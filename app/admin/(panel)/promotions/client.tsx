"use client";
/**
 * FREE GIFT OFFERS — admin workbench
 *
 * Left: the offers (which one is LIVE, quick pause/activate, delete).
 * Right: the editor. It works on a plain JSON "draft" that the API saves and
 * that /api/admin/promotions/preview runs through the REAL engine — so what the
 * preview shows is what the storefront will do.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { afetch } from "@/lib/afetch";

/* ---------------------------------------------------------------- types */

type PoolProduct = { productId: number; variantIds: number[] };
type Pool = { key: string; label: string; autoFill: boolean; categoryIds: number[]; excludeProductIds: number[]; products: PoolProduct[] };
type Slot = { key: string; label: string; poolKey: string; giftType: string; quantity: number };
type Tier = { index: number; key: string; label: string; requiredQuantity: number; slots: Slot[] };
type Draft = {
  id?: string; name: string; slug: string; description?: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED"; priority: number;
  startsAt?: string | null; endsAt?: string | null;
  countMode: "QUANTITY" | "DISTINCT_LINES";
  eligibilityScope: "ALL_PRODUCTS" | "PRODUCTS" | "CATEGORIES";
  highestTierWins: boolean; lockGrantedGifts: boolean; requireGiftSelection: boolean; allowGiftSkipping: boolean;
  maxGiftsPerOrder?: number | null; maxOrders?: number | null;
  eligibleProductIds: number[]; excludedProductIds: number[]; eligibleCategoryIds: number[]; excludedCategoryIds: number[]; excludedGiftProductIds: number[];
  pools: Pool[]; tiers: Tier[];
};
type ListRow = {
  id: string; slug: string; name: string; description: string | null; status: string; priority: number;
  startsAt: string; endsAt: string | null; usedOrders: number; maxOrders: number | null; usageRows: number;
  tiers: { index: number; label: string; requiredQuantity: number; slotCount: number }[];
  pools: { key: string; autoFill: boolean; productCount: number }[];
};
type CatProduct = { id: number; title: string; slug: string; price: number; stock: number; categoryId: number | null; image: string | null; variantCount: number };
type Cat = { products: CatProduct[]; categories: { id: number; name: string; productCount: number }[] };
type SlotView = { key: string; selectionKey: string; tierIndex: number; label: string; status: string; message: string | null; candidates: { variantId: number; name: string; label: string; price: number; selectable: boolean }[] };
type View = {
  eligibleCount: number; currentTierIndex: number | null;
  nextTier: { index: number; label: string; requiredQuantity: number; quantityToGo: number } | null;
  tiers: { index: number; label: string; requiredQuantity: number; quantityToGo: number; unlocked: boolean; isCurrent: boolean; slots: { key: string; label: string; quantity: number }[] }[];
  slots: SlotView[]; giftCount: number; giftValue: number; warnings: string[]; errors: string[];
};

const GIFT_TYPES = ["SHIRT", "T_SHIRT", "PANTS", "DENIM", "DRESS", "BAG", "FOOTWEAR", "ACCESSORY", "CUSTOM"];
const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const DEFAULT_DRAFT = (): Draft => ({
  name: "Buy more. Get more.", slug: "buy-more-get-more", description: "Free pieces at 3, 4 and 6 items.",
  status: "DRAFT", priority: 20, startsAt: null, endsAt: null,
  countMode: "QUANTITY", eligibilityScope: "ALL_PRODUCTS",
  highestTierWins: true, lockGrantedGifts: false, requireGiftSelection: true, allowGiftSkipping: true,
  maxGiftsPerOrder: null, maxOrders: null,
  eligibleProductIds: [], excludedProductIds: [], eligibleCategoryIds: [], excludedCategoryIds: [], excludedGiftProductIds: [],
  pools: [
    { key: "shirts", label: "Shirt / T-Shirt", autoFill: false, categoryIds: [], excludeProductIds: [], products: [] },
    { key: "denim", label: "Baggy Denim", autoFill: false, categoryIds: [], excludeProductIds: [], products: [] },
  ],
  tiers: [
    { index: 1, key: "tier-3", label: "Buy 3 — Free Shirt / T-Shirt", requiredQuantity: 3, slots: [{ key: "shirt", label: "Shirt / T-Shirt", poolKey: "shirts", giftType: "SHIRT", quantity: 1 }] },
    { index: 2, key: "tier-4", label: "Buy 4 — Free Baggy Denim", requiredQuantity: 4, slots: [{ key: "denim", label: "Baggy Denim", poolKey: "denim", giftType: "DENIM", quantity: 1 }] },
    { index: 3, key: "tier-6", label: "Buy 6 — Free Denim + Shirt", requiredQuantity: 6, slots: [
      { key: "denim", label: "Baggy Denim", poolKey: "denim", giftType: "DENIM", quantity: 1 },
      { key: "shirt", label: "Shirt / T-Shirt", poolKey: "shirts", giftType: "SHIRT", quantity: 1 },
    ] },
  ],
});

/* ------------------------------------------------------------------ page */

export default function PromotionsClient() {
  const [list, setList] = useState<ListRow[]>([]);
  const [cat, setCat] = useState<Cat>({ products: [], categories: [] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<"basics" | "tiers" | "pools" | "scope" | "preview">("basics");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [usages, setUsages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  /* 401 = token nei/sesh. Age eta "noti ok" (sobuj) box e "Unauthorized" dekhato — confuse kore.
     Ekhon alada sign-in card, ar token thakle login page e abar giyei dhuke jabe. */
  const [authNeeded, setAuthNeeded] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const load = useCallback(async () => {
    setLoading(true);
    const r = await afetch("/api/admin/promotions");
    if (r.ok) { const j = await r.json(); setList(j.promotions); setCat(j.catalog); setAuthNeeded(false); }
    else if (r.status === 401) { setAuthNeeded(true); setMsg(""); }
    else setMsg((await r.json().catch(() => ({}))).error || "Could not load offers");
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEditor = async (id?: string) => {
    setErrors([]); setWarnings([]); setTab("basics"); setMsg(""); setUsages([]);
    if (!id) { setDraft(DEFAULT_DRAFT()); return; }
    const r = await afetch("/api/admin/promotions/" + id);
    if (!r.ok) { if (!authFailed(r)) setMsg("Could not open that offer"); return; }
    const j = await r.json();
    setDraft(j.draft); setUsages(j.usages || []);
  };

  /* Session na thakle (401) sob write path bondho kore sign-in card dekhi.
     Ei guard na thakle "No problems found ✓" / "Saved ✓" er moto BHUL success message ashto. */
  const authFailed = (r: Response) => {
    if (r.status !== 401 && r.status !== 403) return false;
    setAuthNeeded(true); setMsg(""); setErrors([]); setWarnings([]);
    return true;
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const updTier = (ti: number, p: Partial<Tier>) => setDraft((d) => (d ? { ...d, tiers: d.tiers.map((t, i) => (i === ti ? { ...t, ...p } : t)) } : d));
  const updSlot = (ti: number, si: number, p: Partial<Slot>) =>
    setDraft((d) => (d ? { ...d, tiers: d.tiers.map((t, i) => (i === ti ? { ...t, slots: t.slots.map((s, j) => (j === si ? { ...s, ...p } : s)) } : t)) } : d));

  const save = async () => {
    const d = draftRef.current;
    if (!d) return;
    setBusy(true); setMsg("");
    const url = d.id ? "/api/admin/promotions/" + d.id : "/api/admin/promotions";
    const r = await afetch(url, { method: d.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: d }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setErrors([]); setMsg("Saved ✓"); await load(); if (!d.id && j.id) setDraft({ ...d, id: j.id }); }
    else if (!authFailed(r)) { setErrors(j.errors || [j.error || "Save failed"]); setMsg(""); }
    setBusy(false);
  };

  const validate = async () => {
    const d = draftRef.current;
    if (!d) return;
    setBusy(true);
    const r = await afetch("/api/admin/promotions?dry=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: d }) });
    if (authFailed(r)) { setBusy(false); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !Array.isArray(j.errors)) {
      setErrors([j.error || "Check fail korlo — abar try korun"]); setWarnings([]); setMsg("");
    } else {
      setErrors(j.errors || []); setWarnings(j.warnings || []);
      setMsg((j.errors || []).length === 0 ? "No problems found ✓" : "");
    }
    setBusy(false);
  };

  const quickStatus = async (row: ListRow, status: string) => {
    setBusy(true);
    const r = await afetch("/api/admin/promotions/" + row.id);
    if (!r.ok) { authFailed(r); setBusy(false); return; }
    const j = await r.json();
    await afetch("/api/admin/promotions/" + row.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: { ...j.draft, status } }) });
    await load(); setBusy(false);
  };

  const remove = async (row: ListRow) => {
    if (!confirm(`Delete “${row.name}”?`)) return;
    setBusy(true);
    const r = await afetch("/api/admin/promotions/" + row.id, { method: "DELETE" });
    if (authFailed(r)) { setBusy(false); return; }
    const j = await r.json().catch(() => ({}));
    if (j.note) setMsg(j.note);
    await load(); setBusy(false);
  };

  const liveId = useMemo(() => {
    const now = Date.now();
    const live = list
      .filter((p) => p.status === "ACTIVE" && new Date(p.startsAt).getTime() <= now && (!p.endsAt || new Date(p.endsAt).getTime() >= now))
      .sort((a, b) => a.priority - b.priority);
    return live[0]?.id ?? null;
  }, [list]);

  return (
    <>
      <div className="admin-top">
        <h1>Free gift offers</h1>
        <button className="abtn primary" onClick={() => openEditor()}>+ New offer</button>
      </div>

      {authNeeded && (
        <div className="noti warn" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>🔒 <b>Sign in dorkar</b> — apnar admin session nei ba expire hoye geche.</span>
          <a className="abtn primary sm" href="/admin/login" style={{ textDecoration: "none" }}>Sign in kore ashi</a>
        </div>
      )}

      {msg && <div className="noti ok">{msg}</div>}

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: draft ? "minmax(320px,.95fr) 1.7fr" : "1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Offers ({list.length})</h3></div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Offer</th><th>Status</th><th>Used</th><th></th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} style={draft?.id === p.id ? { background: "var(--ad-line-soft)" } : undefined}>
                    <td>
                      <b>{p.name}</b>{liveId === p.id && <span className="promo-chip live">live</span>}
                      <div style={{ color: "var(--ad-mute)", fontSize: 12 }}>
                        {p.tiers.map((t) => `${t.requiredQuantity}→${t.slotCount} gift${t.slotCount > 1 ? "s" : ""}`).join(" · ")}
                      </div>
                      <div style={{ color: "var(--ad-mute)", fontSize: 11.5 }}>
                        {p.pools.map((g) => `${g.key}${g.autoFill ? " (auto)" : ""}·${g.productCount}`).join("  ")}
                      </div>
                    </td>
                    <td><span className={"promo-chip " + p.status.toLowerCase()}>{p.status.toLowerCase()}</span></td>
                    <td>{p.usedOrders}{p.maxOrders ? "/" + p.maxOrders : ""}<div style={{ color: "var(--ad-mute)", fontSize: 11.5 }}>{p.usageRows} claim(s)</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="abtn sm" onClick={() => openEditor(p.id)}>Edit</button>{" "}
                      {p.status === "ACTIVE"
                        ? <button className="abtn sm" disabled={busy} onClick={() => quickStatus(p, "PAUSED")}>Pause</button>
                        : <button className="abtn sm" disabled={busy} onClick={() => quickStatus(p, "ACTIVE")}>Activate</button>}{" "}
                      <button className="abtn sm danger" disabled={busy} onClick={() => remove(p)}>✕</button>
                    </td>
                  </tr>
                ))}
                {!loading && list.length === 0 && <tr><td colSpan={4} style={{ padding: 30, color: "var(--muted)" }}>No offers yet — “New offer” diye shuru korun.</td></tr>}
                {loading && <tr><td colSpan={4} style={{ padding: 30 }}>Loading…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="acard-b promo-help">
            Ekadhik offer active thakle <b>lowest priority number</b> wala ta storefront e chalbe.
          </div>
        </div>

        {draft && (
          <div className="acard">
            <div className="acard-h">
              <h3>{draft.id ? "Editing — " : "New — "}{draft.name || "untitled"}</h3>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="abtn sm" onClick={validate} disabled={busy}>Check</button>
                <button className="abtn sm" onClick={() => { setDraft(null); setErrors([]); setWarnings([]); }}>Close</button>
                <button className="abtn primary sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              </div>
            </div>

            <div className="promo-tabs">
              {(["basics", "tiers", "pools", "scope", "preview"] as const).map((t) => (
                <button key={t} className={"promo-tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
                  {t === "basics" ? "Basics" : t === "tiers" ? `Tiers (${draft.tiers.length})` : t === "pools" ? `Gift pools (${draft.pools.length})` : t === "scope" ? "Qualifying" : "Preview"}
                </button>
              ))}
            </div>

            {errors.length > 0 && (
              <div className="noti err">
                <b>Fix these first:</b>
                <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="noti warn">
                <b>Heads-up:</b>
                <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}

            {tab === "basics" && (
              <div className="acard-b form-grid">
                <div className="af"><label>Name *</label><input value={draft.name} onChange={(e) => patch({ name: e.target.value, slug: draft.id ? draft.slug : slugify(e.target.value) })} /></div>
                <div className="af"><label>Slug *</label><input value={draft.slug} onChange={(e) => patch({ slug: slugify(e.target.value) })} /></div>
                <div className="af full"><label>Description (cart panel e dekhabe)</label><input value={draft.description || ""} onChange={(e) => patch({ description: e.target.value })} /></div>
                <div className="af"><label>Status</label>
                  <select value={draft.status} onChange={(e) => patch({ status: e.target.value as Draft["status"] })}>
                    <option value="DRAFT">Draft (hidden)</option>
                    <option value="ACTIVE">Active (live)</option>
                    <option value="PAUSED">Paused</option>
                    <option value="ENDED">Ended</option>
                  </select>
                </div>
                <div className="af"><label>Priority (lower wins)</label><input type="number" value={draft.priority} onChange={(e) => patch({ priority: Number(e.target.value) || 0 })} /></div>
                <div className="af"><label>Starts</label><input type="datetime-local" value={(draft.startsAt || "").slice(0, 16)} onChange={(e) => patch({ startsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></div>
                <div className="af"><label>Ends (blank = never)</label><input type="datetime-local" value={(draft.endsAt || "").slice(0, 16)} onChange={(e) => patch({ endsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></div>
                <div className="af"><label>Max orders (blank = ∞)</label><input type="number" value={draft.maxOrders ?? ""} onChange={(e) => patch({ maxOrders: e.target.value ? Number(e.target.value) : null })} /></div>
                <div className="af"><label>Max gifts per order</label><input type="number" value={draft.maxGiftsPerOrder ?? ""} onChange={(e) => patch({ maxGiftsPerOrder: e.target.value ? Number(e.target.value) : null })} /></div>
                <div className="full promo-rules">
                  <Toggle label="Count by quantity" hint="Off = distinct products (3 different products)." on={draft.countMode === "QUANTITY"} onClick={() => patch({ countMode: draft.countMode === "QUANTITY" ? "DISTINCT_LINES" : "QUANTITY" })} />
                  <Toggle label="Highest tier wins" hint="Buy 4 → only the 4-item reward, not the 3-item one too." on={draft.highestTierWins} onClick={() => patch({ highestTierWins: !draft.highestTierWins })} />
                  <Toggle label="Gift must be picked" hint="Cart asks for a gift before checkout." on={draft.requireGiftSelection} onClick={() => patch({ requireGiftSelection: !draft.requireGiftSelection })} />
                  <Toggle label="Can skip the gift" hint="Order without taking the free piece is allowed." on={draft.allowGiftSkipping} onClick={() => patch({ allowGiftSkipping: !draft.allowGiftSkipping })} />
                  <Toggle label="Lock granted gifts" hint="Picked gift cannot be swapped while its tier still holds." on={draft.lockGrantedGifts} onClick={() => patch({ lockGrantedGifts: !draft.lockGrantedGifts })} />
                </div>
              </div>
            )}

            {tab === "tiers" && (
              <div className="acard-b">
                {draft.tiers.map((tier, ti) => (
                  <div className="promo-row" key={ti}>
                    <div className="promo-row-h">
                      <b>Tier {tier.index}</b>
                      <input style={{ maxWidth: 210 }} value={tier.label} onChange={(e) => updTier(ti, { label: e.target.value })} />
                      <label className="promo-inline">
                        Buy <input type="number" style={{ width: 66 }} value={tier.requiredQuantity} onChange={(e) => updTier(ti, { requiredQuantity: Number(e.target.value) || 1 })} /> items
                      </label>
                      <button className="abtn sm danger" onClick={() => patch({ tiers: draft.tiers.filter((_, i) => i !== ti) })}>Remove tier</button>
                    </div>
                    {tier.slots.map((slot, si) => (
                      <div className="promo-slot-row" key={si}>
                        <input placeholder="slot key" value={slot.key} onChange={(e) => updSlot(ti, si, { key: e.target.value })} />
                        <input placeholder="label shoppers see" value={slot.label} onChange={(e) => updSlot(ti, si, { label: e.target.value })} />
                        <select value={slot.poolKey} onChange={(e) => updSlot(ti, si, { poolKey: e.target.value })}>
                          <option value="">— gift pool —</option>
                          {draft.pools.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.key})</option>)}
                        </select>
                        <select value={slot.giftType} onChange={(e) => updSlot(ti, si, { giftType: e.target.value })}>
                          {GIFT_TYPES.map((g) => <option key={g} value={g}>{g.replace("_", " ").toLowerCase()}</option>)}
                        </select>
                        <input type="number" style={{ width: 66 }} title="free pieces this slot gives" value={slot.quantity} onChange={(e) => updSlot(ti, si, { quantity: Number(e.target.value) || 1 })} />
                        <button className="abtn sm danger" onClick={() => updTier(ti, { slots: tier.slots.filter((_, i) => i !== si) })}>✕</button>
                      </div>
                    ))}
                    <button className="abtn sm" onClick={() => updTier(ti, { slots: [...tier.slots, { key: "slot-" + (tier.slots.length + 1), label: "Free piece", poolKey: draft.pools[0]?.key || "", giftType: "CUSTOM", quantity: 1 }] })}>+ slot</button>
                  </div>
                ))}
                <button className="abtn primary" onClick={() => {
                  const n = draft.tiers.length + 1;
                  patch({ tiers: [...draft.tiers, { index: n, key: "tier-" + n, label: "Buy more — Free piece", requiredQuantity: 2 + n, slots: [{ key: "slot-1", label: "Free piece", poolKey: draft.pools[0]?.key || "", giftType: "CUSTOM", quantity: 1 }] }] });
                }}>+ Add tier</button>
                <p className="promo-help">requiredQuantity = kotota item kinle ei gift unlock hobe. Ek tier e ekadhik slot = ek sathe onek gift.</p>
              </div>
            )}

            {tab === "pools" && (
              <div className="acard-b">
                {draft.pools.map((pool, pi) => (
                  <PoolEditor key={pi} pool={pool} cat={cat}
                    onChange={(p) => patch({ pools: draft.pools.map((x, i) => (i === pi ? p : x)) })}
                    onRemove={() => patch({
                      pools: draft.pools.filter((_, i) => i !== pi),
                      tiers: draft.tiers.map((t) => ({ ...t, slots: t.slots.filter((s) => s.poolKey !== pool.key) })),
                    })} />
                ))}
                <button className="abtn primary" onClick={() => patch({ pools: [...draft.pools, { key: "pool-" + (draft.pools.length + 1), label: "New pool", autoFill: false, categoryIds: [], excludeProductIds: [], products: [] }] })}>+ Add gift pool</button>
                <p className="promo-help">Gift pool = free piece er choice list. <b>Hand-pick</b> korte paren, ba <b>category auto-fill</b> on kore category select korle oi category-r sob active product nijei add hobe.</p>
              </div>
            )}

            {tab === "scope" && (
              <div className="acard-b form-grid">
                <div className="af full"><label>Kon item gulo tier hishebe count hobe?</label>
                  <select value={draft.eligibilityScope} onChange={(e) => patch({ eligibilityScope: e.target.value as Draft["eligibilityScope"] })}>
                    <option value="ALL_PRODUCTS">Shop er sob product</option>
                    <option value="PRODUCTS">Only the products I pick</option>
                    <option value="CATEGORIES">Only the categories I pick</option>
                  </select>
                </div>
                {draft.eligibilityScope === "PRODUCTS" && (
                  <div className="full"><ProdPicker label="Qualifying products" products={cat.products} selected={draft.eligibleProductIds} onChange={(ids) => patch({ eligibleProductIds: ids })} /></div>
                )}
                {draft.eligibilityScope === "CATEGORIES" && (
                  <div className="full">
                    <CatPicker label="Qualifying categories" cats={cat.categories} selected={draft.eligibleCategoryIds} onChange={(ids) => patch({ eligibleCategoryIds: ids })} />
                    <CatPicker label="Excluded categories (subtract)" cats={cat.categories} selected={draft.excludedCategoryIds} onChange={(ids) => patch({ excludedCategoryIds: ids })} />
                  </div>
                )}
                <div className="full"><ProdPicker label="Never count these products" products={cat.products} selected={draft.excludedProductIds} onChange={(ids) => patch({ excludedProductIds: ids })} /></div>
                <div className="full"><ProdPicker label="Never give these as gifts" products={cat.products} selected={draft.excludedGiftProductIds} onChange={(ids) => patch({ excludedGiftProductIds: ids })} /></div>
              </div>
            )}

            {tab === "preview" && <PreviewPanel draft={draft} cat={cat} />}
          </div>
        )}
      </div>

      {draft?.id && usages.length > 0 && (
        <div className="acard" style={{ marginTop: 16 }}>
          <div className="acard-h"><h3>Recent claims ({usages.length})</h3></div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Customer</th><th>Tier</th><th>Gifts</th><th>Value</th></tr></thead>
              <tbody>{usages.map((u) => <tr key={u.id}><td><b>{u.orderCode}</b></td><td>{u.customer}</td><td>#{u.tierIndex}</td><td>{u.giftCount}</td><td>{money(u.giftValue)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- controls */

function Toggle({ label, hint, on, onClick }: { label: string; hint?: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={"promo-toggle" + (on ? " on" : "")} onClick={onClick} aria-pressed={on}>
      <span className="promo-toggle-dot" aria-hidden />
      <span>
        <b>{label}</b>
        {hint && <em>{hint}</em>}
      </span>
    </button>
  );
}

function ProdPicker({ label, hint, products, selected, onChange }: { label: string; hint?: string; products: CatProduct[]; selected: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle ? products.filter((p) => p.title.toLowerCase().includes(needle)) : products;
    return pool.filter((p) => !selected.includes(p.id)).slice(0, 8);
  }, [q, products, selected]);

  return (
    <div className="promo-picker">
      <label className="promo-picker-label">{label}{hint && <em> · {hint}</em>}</label>
      <div className="promo-chips">
        {selected.map((id) => {
          const p = byId.get(id);
          return (
            <span className="promo-chip solid" key={id}>
              {p?.title || "Product #" + id}
              <button type="button" aria-label="Remove" onClick={() => onChange(selected.filter((x) => x !== id))}>✕</button>
            </span>
          );
        })}
        {selected.length === 0 && <span className="promo-empty">none picked</span>}
      </div>
      <div className="promo-search">
        <input value={q} placeholder="Search products…" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
        {open && matches.length > 0 && (
          <div className="promo-search-list">
            {matches.map((p) => (
              <button type="button" key={p.id} onClick={() => { onChange([...selected, p.id]); setQ(""); }}>
                <b>{p.title}</b><span>{money(p.price)} · stock {p.stock}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CatPicker({ label, cats, selected, onChange }: { label: string; cats: Cat["categories"]; selected: number[]; onChange: (ids: number[]) => void }) {
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="promo-picker">
      <label className="promo-picker-label">{label}</label>
      <div className="promo-chips">
        {cats.map((c) => (
          <button type="button" key={c.id} className={"promo-chip" + (selected.includes(c.id) ? " solid" : "")} onClick={() => toggle(c.id)}>
            {c.name} <span className="promo-mute">{c.productCount}</span>
          </button>
        ))}
        {cats.length === 0 && <span className="promo-empty">No categories</span>}
      </div>
    </div>
  );
}

function PoolEditor({ pool, cat, onChange, onRemove }: { pool: Pool; cat: Cat; onChange: (p: Pool) => void; onRemove: () => void }) {
  const autoCount = useMemo(() => {
    if (!pool.autoFill) return 0;
    const ids = new Set(pool.categoryIds);
    return cat.products.filter((p) => p.categoryId != null && ids.has(p.categoryId)).length;
  }, [pool.autoFill, pool.categoryIds, cat.products]);
  /* Per-rule exclusion — excluded ta hand-picked ar auto-fill dutoi theke bad, tai count-o
     excluded bad diye dekhi (owner jate bhul na koren). */
  const excludedSet = useMemo(() => new Set(pool.excludeProductIds.map(Number)), [pool.excludeProductIds]);
  const excludedHand = useMemo(() => pool.products.filter((p) => excludedSet.has(Number(p.productId))).length, [pool.products, excludedSet]);
  const excludedAuto = useMemo(() => {
    if (!pool.autoFill) return 0;
    const ids = new Set(pool.categoryIds);
    return cat.products.filter((p) => p.categoryId != null && ids.has(p.categoryId) && excludedSet.has(Number(p.id))).length;
  }, [pool.autoFill, pool.categoryIds, cat.products, excludedSet]);

  return (
    <div className="promo-row">
      <div className="promo-row-h">
        <input style={{ maxWidth: 120 }} placeholder="key" value={pool.key} onChange={(e) => onChange({ ...pool, key: e.target.value })} />
        <input style={{ maxWidth: 220 }} placeholder="label (Shirt / T-Shirt)" value={pool.label} onChange={(e) => onChange({ ...pool, label: e.target.value })} />
        <button className="abtn sm" onClick={() => onChange({ ...pool, autoFill: !pool.autoFill })}>
          {pool.autoFill ? "✓ auto-fill from categories" : "auto-fill from categories"}
        </button>
        <span className="promo-mute">
          {pool.products.length - excludedHand} hand-picked{pool.autoFill ? ` + ${autoCount - excludedAuto} from categories` : ""}
          {pool.excludeProductIds.length > 0 && <> · <b>{pool.excludeProductIds.length} excluded</b></>}
        </span>
        <button className="abtn sm danger" onClick={onRemove}>Delete pool</button>
      </div>
      {pool.autoFill && (
        <div className="promo-sub">
          <CatPicker label="Categories that join automatically" cats={cat.categories} selected={pool.categoryIds} onChange={(ids) => onChange({ ...pool, categoryIds: ids })} />
        </div>
      )}
      <ProdPicker label="Hand-picked products" hint="variant = all, unless you limit them later"
        products={cat.products}
        selected={pool.products.map((p) => p.productId)}
        onChange={(ids) => onChange({
          ...pool,
          products: ids.map((id) => pool.products.find((p) => p.productId === id) || { productId: id, variantIds: [] }),
        })} />
      {/* Per-rule exclusion: ei pool er jonno kon product gulo kokhono offer hobe na.
          Auto-fill category te thakleo, hand-picked list e thakleo — duitai theke filter hoy. */}
      <ProdPicker label="Exclude from this pool — never offered here"
        hint="auto-fill ba hand-picked — doutai theke bad porbe; baki rule/pool e ei product age er moto-i thakbe"
        products={cat.products}
        selected={pool.excludeProductIds}
        onChange={(ids) => onChange({ ...pool, excludeProductIds: ids })} />
    </div>
  );
}

function PreviewPanel({ draft, cat }: { draft: Draft; cat: Cat }) {
  const [items, setItems] = useState<{ productId: number; qty: number }[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const timer = useRef<any>(null);
  const seq = useRef(0);

  const byId = useMemo(() => new Map(cat.products.map((p) => [p.id, p])), [cat.products]);
  const count = items.reduce((s, i) => s + i.qty, 0);

  const run = useCallback(async (cart: { productId: number; qty: number }[]) => {
    const my = ++seq.current;
    setBusy(true);
    const r = await afetch("/api/admin/promotions/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, items: cart }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (my === seq.current) { setView(null); setErr(j.error === "Unauthorized" ? "Session nei — upore “Sign in” e giye abar chin." : (j.error || "Preview fail korlo")); setBusy(false); }
      return;
    }
    const j = await r.json();
    if (my === seq.current) { setView(j.view); setErr(""); setBusy(false); }
  }, [draft]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!items.length) { setView(null); return; }
    timer.current = setTimeout(() => run(items), 320);
    return () => clearTimeout(timer.current);
  }, [items, run]);

  const quickFill = (n: number) => {
    const picks = cat.products.filter((p) => p.stock > 0).slice(0, n);
    setItems(picks.map((p) => ({ productId: p.id, qty: 1 })));
  };
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return cat.products.filter((p) => p.title.toLowerCase().includes(needle)).slice(0, 6);
  }, [q, cat.products]);

  const setQty = (productId: number, qty: number) =>
    setItems((prev) => qty <= 0 ? prev.filter((i) => i.productId !== productId) : prev.map((i) => (i.productId === productId ? { ...i, qty } : i)));

  return (
    <div className="acard-b">
      <div className="promo-preview-top">
        <span className="promo-preview-count"><b>{count}</b> item{count === 1 ? "" : "s"} in test cart</span>
        <button className="abtn sm" onClick={() => quickFill(3)}>+3</button>
        <button className="abtn sm" onClick={() => quickFill(4)}>+4</button>
        <button className="abtn sm" onClick={() => quickFill(6)}>+6</button>
        <button className="abtn sm" onClick={() => setItems([])} disabled={!items.length}>Clear</button>
        <button className="abtn sm primary" onClick={() => run(items)} disabled={busy || !items.length}>{busy ? "Running…" : "Run"}</button>
      </div>

      <div className="promo-search" style={{ maxWidth: 420 }}>
        <input value={q} placeholder="Add a product to the test cart…" onChange={(e) => setQ(e.target.value)} />
        {matches.length > 0 && (
          <div className="promo-search-list">
            {matches.map((p) => (
              <button type="button" key={p.id} onClick={() => { setItems((prev) => prev.some((i) => i.productId === p.id) ? prev : [...prev, { productId: p.id, qty: 1 }]); setQ(""); }}>
                <b>{p.title}</b><span>{money(p.price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <ul className="promo-cart">
          {items.map((i) => (
            <li key={i.productId}>
              <span>{byId.get(i.productId)?.title || "#" + i.productId}</span>
              <span className="promo-qty">
                <button type="button" onClick={() => setQty(i.productId, i.qty - 1)}>−</button>
                <b>{i.qty}</b>
                <button type="button" onClick={() => setQty(i.productId, i.qty + 1)}>+</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {err && <div className="noti warn">{err}</div>}
      {!view && items.length === 0 && <p className="promo-help">Test cart khali — “+3 / +4 / +6” chap diye ek click e apnar rule ta test korun.</p>}
      {draft.status !== "ACTIVE" && <p className="promo-help">Preview offer ta ke <b>live</b> dhore chalaay — status/schedule ekhane count hoy na.</p>}

      {view && (
        <div className="promo-view">
          <div className="promo-view-head">
            <span className={"promo-chip " + (view.currentTierIndex ? "live" : "")}>
              {view.currentTierIndex ? `tier #${view.currentTierIndex} unlocked` : "no reward yet"}
            </span>
            <span className="promo-mute">qualifying items: <b>{view.eligibleCount}</b></span>
            {view.nextTier && <span className="promo-mute">{view.nextTier.quantityToGo} more → {view.nextTier.label}</span>}
            {view.giftCount > 0 && <span className="promo-chip solid">{view.giftCount} free · {money(view.giftValue)}</span>}
          </div>

          <ol className="promo-ladder">
            {view.tiers.map((t) => (
              <li key={t.index} className={t.isCurrent ? "on" : t.unlocked ? "done" : ""}>
                <b>{t.requiredQuantity}+</b> {t.label} <span>{t.isCurrent ? "✓ unlocked" : t.unlocked ? "reached" : `${t.quantityToGo} more`}</span>
              </li>
            ))}
          </ol>

          {view.slots.map((s) => (
            <div className={"promo-slot-view " + s.status.toLowerCase()} key={s.selectionKey}>
              <div><b>{s.label}</b> <span className="promo-chip">{s.status.toLowerCase().replace("_", " ")}</span></div>
              {s.message && <div className="promo-mute">{s.message}</div>}
              {s.candidates.length > 0 && (
                <div className="promo-cands">
                  {s.candidates.slice(0, 6).map((c) => (
                    <span className={"promo-chip" + (c.selectable ? "" : " off")} key={c.variantId}>{c.name} · {c.label} · {money(c.price)}</span>
                  ))}
                  {s.candidates.length > 6 && <span className="promo-mute">+{s.candidates.length - 6} more</span>}
                </div>
              )}
            </div>
          ))}

          {view.warnings.map((w) => <p className="promo-help" key={w}>⚠ {w}</p>)}
        </div>
      )}
    </div>
  );
}
