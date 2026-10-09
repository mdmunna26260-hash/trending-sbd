"use client";
import { FmtDate } from "@/components/dates";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { afetch, withToken } from "@/lib/afetch";
import { ThemeIconToggle, ThemeSwitchRow } from "./theme-toggle";
import { isHiddenAdminHref } from "@/lib/features";
import { FEATURES } from "@/lib/features";

const NAV_ALL: { group: string; gicon: string; items: { href: string; label: string; icon: string; badge?: string }[] }[] = [
  { group: "Overview", gicon: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zM13 9h8V3h-8v6z", items: [
    { href: "/admin/dashboard", label: "Dashboard", icon: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zM13 9h8V3h-8v6z" },
    { href: "/admin/profit", label: "Profit & Margin", icon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6M3 22h18" },
  ]},
  { group: "Commerce", gicon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0", items: [
    { href: "/admin/orders", label: "Orders", icon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0", badge: "pending" },
    { href: "/admin/scan", label: "Scan to pack", icon: "M3 5h4l2 12h10l2-8H7M9 21a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3 5v2M5 8H3" },
    { href: "/admin/payments", label: "Payments", icon: "M2 7h20v10H2zM2 11h20M6 15h3" },
    { href: "/admin/waitlist", label: "Waitlist", icon: "M12 2a6 6 0 0 0-6 6c0 4-2 5-2 5h16s-2-1-2-5a6 6 0 0 0-6-6zM10.5 20a1.8 1.8 0 0 0 3 0" },
    { href: "/admin/products", label: "Products", icon: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" },
    { href: "/admin/stock", label: "Stock", icon: "M3 3h18v4H3zM5 7v14h14V7M9 11h6", badge: "stock" },
    { href: "/admin/catalog", label: "Categories & Collections", icon: "M4 6h16M4 12h16M4 18h10" },
    { href: "/admin/customers", label: "Customers", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
    { href: "/admin/coupons", label: "Coupons", icon: "M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2m-5 0 2 2-2 2h-4" },
    { href: "/admin/promotions", label: "Free gift offers", icon: "M20 12v8H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M4 10h16M12 4v4M9 16h6" },
  ]},
  { group: "Engagement", gicon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z", items: [
    { href: "/admin/reviews", label: "Reviews", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" },
    { href: "/admin/sms", label: "SMS", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5" },
    { href: "/admin/loyalty", label: "Loyalty & Referral", icon: "M12 2l2.9 6 6.1.9-4.5 4.3 1.1 6.3L12 16.6 6.4 19.5l1.1-6.3L3 8.9 9.1 8z" },
    { href: "/admin/marketing", label: "Marketing", icon: "M3 11l18-7-7 18-2.5-7.5z" },
    { href: "/admin/campaigns", label: "Newsletter & Push", icon: "M4 4h16v16H4zM4 7l8 6 8-6" },
    { href: "/admin/blog", label: "Blog", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M11 9H8" },
  ]},
  { group: "WhatsApp", gicon: "M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.2A8 8 0 1 1 21 12zM8.5 11h.01M12 11h.01M15.5 11h.01", items: [
    { href: "/admin/whatsapp/compose", label: "New message", icon: "M12 5v14M5 12h14" },
    { href: "/admin/whatsapp/new", label: "New campaign", icon: "M22 2L11 13M22 2l-7 20-4-9-9-4z" },
    { href: "/admin/whatsapp", label: "Broadcast & Queue", icon: "M3 11l18-7-7 18-2.5-7.5zM14 14l4-4" },
    { href: "/admin/whatsapp/devices", label: "Devices", icon: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2" },
    { href: "/admin/whatsapp/templates", label: "Templates", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4" },
    { href: "/admin/inbox", label: "Inbox", icon: "M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.2A8 8 0 1 1 21 12zM8.5 11h.01M12 11h.01M15.5 11h.01" },
  ]},
  { group: "Growth tools", gicon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6", items: [
    { href: "/admin/analytics", label: "Advanced Analytics", icon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" },
    { href: "/admin/couriers", label: "Couriers & RTO", icon: "M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm13 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
    { href: "/admin/tracking", label: "Tracking & Pixels", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
    { href: "/admin/links", label: "Campaign links", icon: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" },
    { href: "/admin/backup", label: "Backup", icon: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8" },
    { href: "/admin/logs", label: "Logs", icon: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" },
    { href: "/admin/security", label: FEATURES.adminTwoFactor ? "Security & 2FA" : "Security", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" },
    { href: "/admin/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4 1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4-1.6c.06-.4.1-.8.1-1.2z" },
    { href: "/admin/users", label: "Team", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
    { href: "/admin/audit", label: "Audit Log", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" },
  ]},
];

/* Hidden features (lib/features.ts) — switch off thakle oi item gulo nav theke chere jay, ar
   group ta khali hoye gele group header-o gayeb hoy. Code e NAV_ALL puro ache; switch on korlei
   sob ferot ashe. Badges/active-check sob ei filtered NAV-i use kore, tai alada kichu lagbe na. */
const NAV = NAV_ALL
  .map((g) => ({ ...g, items: g.items.filter((it) => !isHiddenAdminHref(it.href)) }))
  .filter((g) => g.items.length > 0);

function decodeToken(t?: string | null): any {
  try {
    const payload = (t || "").split(".")[0];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

/* ---- global search (orders + products) ---- */
function GlobalSearch({ token, link }: { token: string; link: (href: string) => string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ orders: any[]; products: any[] } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setRes(null); setOpen(false); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch("/api/admin/global-search?q=" + encodeURIComponent(q.trim()) + (token ? "&t=" + encodeURIComponent(token) : ""));
        if (r.ok) { const j = await r.json(); setRes(j); setOpen(true); }
      } catch { /* offline — ignore */ }
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, token]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const close = () => { setOpen(false); setQ(""); };

  return (
    <div className="ad-search" ref={box}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        placeholder="Search order / product…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (res) setOpen(true); }}
        aria-label="Global search"
      />
      {open && res && (
        <div className="ad-search-panel">
          {res.orders.length === 0 && res.products.length === 0 && <div className="sone">Kichu pawa gelo “{q}” e</div>}
          {res.orders.length > 0 && (
            <>
              <div className="sgrp">Orders</div>
              {res.orders.map((o: any) => (
                <a key={o.id} href={link("/admin/orders/" + o.id)} onClick={close}>
                  <b>{o.code}</b><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                  <span className={"pill " + o.status} style={{ fontSize: 9.5 }}>{o.status}</span>
                </a>
              ))}
            </>
          )}
          {res.products.length > 0 && (
            <>
              <div className="sgrp">Products</div>
              {res.products.map((p: any) => (
                <a key={p.id} href={link("/admin/products?edit=" + p.id)} onClick={close}>
                  <b>{p.title}</b><span style={{ marginLeft: "auto", color: "var(--ad-mute)", fontVariantNumeric: "tabular-nums" }}>৳{Math.round(p.price).toLocaleString("en-IN")}</span>
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ pending, lowStock }: { pending: number; lowStock: number }) {
  const path = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const urlT = sp.get("t") || "";
  let t = urlT;
  if (!t) { try { t = localStorage.getItem("sz_admin_token") || ""; } catch {} }
  const link = (href: string) => (t ? href + (href.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : href);
  const user = decodeToken(t);
  const [menuOpen, setMenuOpen] = useState(false);
  /* ≤900px the sidebar becomes an off-canvas drawer (opened from the topbar ☰).
     Track that breakpoint so the desktop "collapsed" (icon-only) preference never
     leaks into the drawer — on a phone the drawer is always full-label. */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => { setIsMobile(mq.matches); if (!mq.matches) setMenuOpen(false); };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // close the drawer whenever the route changes (link tap, back button, global search)
  useEffect(() => { setMenuOpen(false); }, [path]);
  // while the drawer is open: lock page scroll behind it + Esc closes it
  useEffect(() => {
    document.documentElement.classList.toggle("ad-drawer-open", menuOpen);
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.documentElement.classList.remove("ad-drawer-open"); };
  }, [menuOpen]);
  /* Desktop sidebar collapse — persisted in localStorage. Collapsed mode shows
     only icons (~68px wide), expanded shows full labels (248px). On small screens
     we force-expanded because the mobile drawer pattern takes over. */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sz_side_collapsed");
      if (saved === "1") setCollapsed(true);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("sz_side_collapsed", collapsed ? "1" : "0"); } catch {}
    // signal body class so grid template columns can adjust without SSR reflow
    document.body.classList.toggle("ad-side-collapsed", collapsed);
    document.documentElement.classList.toggle("ad-side-collapsed", collapsed);
  }, [collapsed]);
  // Keyboard shortcut: Ctrl/Cmd+B toggles sidebar collapse (desktop only — mobile uses drawer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B") && !e.altKey && !(e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable]")) {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /* Single-accordion mode: only ONE nav section is open at a time.
     - First load: open the section containing the current page (otherwise the
       active link is hidden), Account closed.
     - Clicking a section header: close all other nav sections, toggle this one.
       Account section toggles independently (it's below the divider and never
       steals focus from the working section).
     - When navigating: auto-open the new active page's section, close previous. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = { __account: false };
    NAV.forEach(g => { init[g.group] = g.items.some(it => path.startsWith(it.href)); });
    // Fallback: if nothing matched, open Overview
    if (!Object.values(init).some(Boolean)) init["Overview"] = true;
    return init;
  });
  useEffect(() => {
    setOpenGroups(prev => {
      const next: Record<string, boolean> = { __account: prev.__account };
      let any = false;
      NAV.forEach(g => {
        const isActive = g.items.some(it => path.startsWith(it.href));
        next[g.group] = isActive;
        if (isActive) any = true;
      });
      if (!any) next["Overview"] = true;
      return next;
    });
  }, [path]);
  const toggleGroup = (g: string) => setOpenGroups(prev => {
    const isOpen = prev[g];
    const next: Record<string, boolean> = { ...prev, __account: prev.__account };
    NAV.forEach(x => { next[x.group] = false; });
    next[g] = !isOpen;
    // Keep the active page's section visible so the highlighted link isn't hidden.
    const activeGroup = NAV.find(x => x.items.some(it => path.startsWith(it.href)));
    if (activeGroup && activeGroup.group !== g && !isOpen) next[activeGroup.group] = true;
    return next;
  });
  const logout = async () => {
    try { await afetch("/api/admin/logout", { method: "POST" }); } catch {}
    try { localStorage.removeItem("sz_admin_token"); } catch {}
    document.cookie = "sz_session_fb=; path=/; max-age=0";
    router.push("/admin/login");
  };

  /* ---- notification center (polls every 20s) ---- */
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const loadNotifs = async () => {
    try {
      const r = await afetch("/api/admin/notifications");
      if (r.ok) { const j = await r.json(); setNotifs(j.notifications || []); setUnread(j.unreadCount || 0); }
    } catch {}
  };
  useEffect(() => { loadNotifs(); const iv = setInterval(loadNotifs, 20000); return () => clearInterval(iv); }, []);
  const markAll = async () => { await afetch("/api/admin/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "readAll" }) }); loadNotifs(); };
  const clearAll = async () => { await afetch("/api/admin/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear" }) }); loadNotifs(); };

  const initial = user?.name ? user.name.trim().charAt(0).toUpperCase() : "A";
  // icon-only mode is a desktop preference; the mobile drawer always shows labels
  const isCollapsed = collapsed && !isMobile;

  return (
    <>
      {/* mobile topbar */}
      <div className="admin-topbar">
        <button aria-label="Open menu" aria-expanded={menuOpen} aria-controls="admin-drawer" onClick={() => setMenuOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
        <Link href={link("/admin/dashboard")} className="logo">TRENDING&apos;S<small>COMMERCE PANEL</small></Link>
        <Link href="/" target="_blank" aria-label="View website" style={{ display: "flex", padding: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
        </Link>
        <ThemeIconToggle />
      </div>
      <div className={"admin-scrim" + (menuOpen ? " open" : "")} onClick={() => setMenuOpen(false)} aria-hidden="true" />
    <aside id="admin-drawer" className={"admin-side" + (menuOpen ? " open" : "") + (isCollapsed ? " collapsed" : "")} aria-label="Admin sidebar">
      <div className="side-head">
        <Link href={link("/admin/dashboard")} className="logo" onClick={() => setMenuOpen(false)} title="Dashboard">
          <span className="logo-full">TRENDING&apos;S<span style={{ fontSize: 9.5, display: "block", color: "var(--ad-mute)", letterSpacing: ".24em", fontWeight: 500, marginTop: 3 }}>COMMERCE PANEL</span></span>
          <span className="logo-mini">S</span>
        </Link>
        <button className="drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu" title="Close menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 18 6-6-6-6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6" /></svg>
          )}
        </button>
      </div>

      <GlobalSearch token={t} link={link} />

      <div className="bell-wrap">
        <button className="bell-btn" onClick={() => { setNotifOpen(!notifOpen); loadNotifs(); }} title="Notifications">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          <span className="bell-label">Notifications</span>
          {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
        </button>
      </div>
      {notifOpen && (
        <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
          <div className="np-h">
            <span>Notifications {unread > 0 && <span style={{ color: "var(--ad-red)" }}>({unread} notun)</span>}</span>
            <span style={{ display: "flex", gap: 6 }}>
              {unread > 0 && <button className="abtn sm" onClick={markAll}>Mark all read</button>}
              <button className="abtn sm danger" onClick={clearAll}>Clear</button>
              <button className="abtn sm" onClick={() => setNotifOpen(false)}>✕</button>
            </span>
          </div>
          {notifs.length === 0 && <div className="notif-item" style={{ color: "var(--ad-mute)" }}>Kono notification nai — notun order ashlei ekhane dekhabe.</div>}
          {notifs.map((n) => (
            <div key={n.id} className={"notif-item" + (n.read ? "" : " unread")}>
              <div className="nt">{n.title}</div>
              <div className="nb">{n.body}</div>
              <div className="nd">{n.type} · {<FmtDate iso={n.createdAt} />}</div>
            </div>
          ))}
        </div>
      )}

      <nav className="side-nav" role="navigation" aria-label="Admin main menu">
      {NAV.map((g) => {
        const isOpen = openGroups[g.group] === true;
        const hasActive = g.items.some(it => path.startsWith(it.href));
        const itemCount = g.items.length;
        return (
        <div key={g.group} className={"nav-group" + (isOpen ? " open" : "") + (hasActive ? " has-active" : "")}>
          <button className="grp" onClick={() => toggleGroup(g.group)} aria-expanded={isOpen} aria-controls={"nav-grp-" + g.group.replace(/\s+/g, "-")} title={g.group} aria-label={g.group + (isOpen ? " (expanded)" : " (collapsed)")}>
            <span className="grp-ic" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={g.gicon} /></svg>
            </span>
            <span className="grp-label">{g.group}</span>
            <span className="grp-count" aria-hidden="true">{itemCount}</span>
            <svg className="grp-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div className={"grp-items" + (isOpen ? " is-open" : "")} id={"nav-grp-" + g.group.replace(/\s+/g, "-")} aria-hidden={!isOpen}>
            <div className="grp-items-inner">
              {g.items.map((it) => {
                const badge = it.badge === "pending" ? pending : it.badge === "stock" ? lowStock : 0;
                const isActive = path.startsWith(it.href);
                return (
                  <Link key={it.href} href={link(it.href)} onClick={() => setMenuOpen(false)} className={isActive ? "active" : ""} title={isCollapsed ? it.label : undefined} data-tip={it.label}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={it.icon} /></svg>
                    <span className="nav-label" style={{ flex: 1 }}>{it.label}</span>
                    {badge > 0 && <span className={"nav-badge" + (it.badge === "stock" ? " warn" : "")}>{badge > 99 ? "99+" : badge}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
          {/* Collapsed: a single icon tile per group (shows group glyph, click expands that group OR reveals flyout) */}
          {isCollapsed && (
            <button className={"grp-mini" + (hasActive ? " has-active" : "")} onClick={() => { if (isCollapsed) setCollapsed(false); setOpenGroups(prev => { const n:Record<string,boolean>={}; NAV.forEach(x=>{n[x.group]=false}); n[g.group]=true; return n; }); }} title={g.group + " (" + itemCount + ")"} aria-label={g.group}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={g.gicon} /></svg>
              {hasActive && <span className="grp-mini-dot" />}
            </button>
          )}
        </div>
        );
      })}
      </nav>

      <div className={"nav-group acc-nav" + (openGroups["__account"] ? " open" : "")} style={{ marginTop: "auto" }}>
        <button className="grp" onClick={() => setOpenGroups(prev => ({ ...prev, __account: !prev.__account }))} aria-expanded={!!openGroups["__account"]} aria-controls="nav-grp-Account" title="Account" aria-label={"Account" + (openGroups["__account"] ? " (expanded)" : " (collapsed)")}>
          <span className="grp-ic" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>
          </span>
          <span className="grp-label">Account</span>
          <span className="grp-count" aria-hidden="true">3</span>
          <svg className="grp-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <div className={"grp-items" + (openGroups["__account"] ? " is-open" : "")} id="nav-grp-Account" aria-hidden={!openGroups["__account"]}>
          <div className="grp-items-inner">
            <div className="side-user" title={user?.name || "Admin"}>
              <div className="av">{initial}</div>
              <div className="side-user-meta" style={{ minWidth: 0 }}>
                <div className="nm">{user?.name || "Admin"}</div>
                <div className="em">{user?.email || "…"}</div>
              </div>
            </div>
            <div className="side-theme"><ThemeSwitchRow /></div>
            <Link href="/" target="_blank" title="View storefront" >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
              <span className="nav-label">View Storefront</span>
            </Link>
            <a href="#" onClick={(e) => { e.preventDefault(); logout(); }} className="signout" style={{ color: "var(--ad-red)" }} title="Sign out">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              <span className="nav-label">Sign out</span>
            </a>
          </div>
        </div>
        {isCollapsed && (
          <button className="grp-mini" onClick={() => { setCollapsed(false); setOpenGroups(prev => ({ ...prev, __account: true })); }} title="Account (3)" aria-label="Account">
            <div className="av" style={{ width: 28, height: 28, fontSize: 12 }}>{initial}</div>
          </button>
        )}
      </div>
    </aside>
    </>
  );
}
