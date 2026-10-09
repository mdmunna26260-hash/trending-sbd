"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart, trackEvent } from "./store";
import { ThemeIconToggle } from "./theme-toggle";
import { waLink, telLink } from "@/lib/phone";

export type HeaderCfg = { storeName: string; announcement?: string; categories: { name: string; slug: string }[] };

export function Announcement({ text }: { text?: string }) {
  if (!text) return null;
  // 4 copies are needed for the CSS marquee loop, but a screen reader reads all four
  // (and Google indexes them 4×). The track is decorative; one accessible copy is enough.
  const item = <span className="announce-item">{text}<i className="announce-dot" aria-hidden>◆</i></span>;
  return (
    <div className="announce" role="marquee" aria-hidden="true">
      <div className="announce-track">
        {item}{item}{item}{item}
      </div>
      <span className="sr-only">{text}</span>
    </div>
  );
}

/* Admin-only dashboard shortcut on the storefront header.
   Visible only when the visitor has a valid admin session
   (cookie on production, or ?t= / saved token elsewhere).
   Result is cached in sessionStorage (10 min) so the 99% of visitors
   who are NOT admins don't hit /api/admin/whoami on every page load. */
function AdminDashLink() {
  const [state, setState] = useState<{ show: boolean; href: string }>({ show: false, href: "/admin/dashboard" });
  useEffect(() => {
    (async () => {
      try {
        const cached = sessionStorage.getItem("sz_admin_whoami");
        if (cached && Date.now() - JSON.parse(cached).at < 10 * 60 * 1000) {
          if (JSON.parse(cached).ok) setState((s) => ({ ...s, show: true }));
          return;
        }
      } catch {}
      let token = "";
      try { token = new URLSearchParams(location.search).get("t") || ""; } catch {}
      if (!token) { try { token = localStorage.getItem("sz_admin_token") || ""; } catch {} }
      try {
        const headers: HeadersInit = token ? { Authorization: "Bearer " + token } : {};
        const r = await fetch("/api/admin/whoami", { headers });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok) {
            try { sessionStorage.setItem("sz_admin_whoami", JSON.stringify({ ok: true, at: Date.now() })); } catch {}
            // never put the session token in a link: it ends up in history, Referer and nginx logs
            setState({ show: true, href: "/admin/dashboard" });
            return;
          }
        }
        try { sessionStorage.setItem("sz_admin_whoami", JSON.stringify({ ok: false, at: Date.now() })); } catch {}
      } catch {}
    })();
  }, []);
  if (!state.show) return null;
  return (
    <Link href={state.href} className="icon-btn" title="Admin dashboard" aria-label="Admin dashboard">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
    </Link>
  );
}

export function Header({ storeName, categories }: { storeName: string; categories: { name: string; slug: string }[] }) {
  const { count, ready } = useCart();
  const path = usePathname();
  /* hide header on scroll down, show on scroll up (product page + all pages) */
  const [hid, setHid] = useState(false);
  const lastY = useRef(0);
  const headerRef = useRef<HTMLElement>(null);
  /* cart badge pop when count increases (waits for cart hydration, no pop on page loads) */
  const [pop, setPop] = useState(false);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevCount.current === null) { prevCount.current = count; return; }
    if (count > prevCount.current) {
      prevCount.current = count;
      setPop(true);
      const t = setTimeout(() => setPop(false), 400);
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count, ready]);
  useEffect(() => {
    lastY.current = window.scrollY;
    /* rAF-throttled, exactly like components/bottom-nav.tsx. Without this the handler ran on
       EVERY scroll event — a 120Hz phone fires ~120/s, and each one past the 8px gate called
       setHid(), i.e. a React render mid-scroll. One frame = one decision. */
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        headerRef.current?.classList.toggle("scrolled", y > 24);
        if (Math.abs(y - lastY.current) >= 8) { // ignore tiny scrolls
          setHid(y > lastY.current && y > 120);
          lastY.current = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<any[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => { setOpen(false); setSugg(null); }, [path]);

  /* Auto-close the mobile menu: on scroll, click/tap outside (burger+menu),
     Escape, or resize to desktop width. */
  const burgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    let raf: number | undefined;
    const close = () => setOpen(false);
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = undefined; close(); });
    };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || burgerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onResize = () => { if (window.innerWidth >= 900) close(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open]);

  const onQ = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    if (!v.trim()) { setSugg(null); return; }
    setFetching(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(v));
        const j = await r.json();
        setSugg(j.products || []);
      } catch {}
      setFetching(false);
    }, 220);
  };
  const submitQ = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) { setSugg(null); router.push("/products?q=" + encodeURIComponent(q.trim())); }
  };

  return (
    <>
      <header ref={headerRef} className={"header" + (hid ? " hid" : "")}>
        <div className="container header-inner">
          <button ref={burgerRef} className="burger icon-btn" aria-label="Menu" onClick={() => setOpen(!open)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <Link prefetch href="/" className="logo">{storeName}</Link>
          <nav className="nav">
            <Link prefetch href="/products" className={path === "/products" ? "active" : ""}>Shop All</Link>
            {categories.slice(0, 4).map((c) => (
              <Link key={c.slug} href={"/products?category=" + c.slug} className={path === "/products" ? "" : ""}>{c.name}</Link>
            ))}
            <Link prefetch href="/track">Track Order</Link>
          </nav>
          <div className="header-actions">
            <AdminDashLink />
            <ThemeIconToggle />
            <button className="icon-btn" aria-label="Search" onClick={() => { setSearchOpen(true); setSugg(null); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            <Link prefetch href="/account" className="icon-btn" aria-label="Account" title="My Account">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </Link>
            <Link prefetch href="/cart" className="icon-btn" aria-label="Cart">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              {count > 0 && <span className={"cart-badge" + (pop ? " pop" : "")}>{count > 99 ? "99+" : count}</span>}
            </Link>
          </div>
        </div>
        <nav ref={menuRef} className={"mobile-nav" + (open ? " open" : "")}>
          <Link href="/products" onClick={() => setOpen(false)}>Shop All</Link>
          {categories.slice(0, 6).map((c) => <Link prefetch key={c.slug} href={"/products?category=" + c.slug} onClick={() => setOpen(false)}>{c.name}</Link>)}
          <div className="mobile-nav-divider" />
          <Link href="/track" onClick={() => setOpen(false)}>Track Order</Link>
          <Link href="/account" onClick={() => setOpen(false)}>My Account</Link>
          <Link href="/cart" onClick={() => setOpen(false)}>Cart{count > 0 ? ` (${count})` : ""}</Link>
        </nav>
      </header>

      {searchOpen && (
        <div className="search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-panel" onClick={(e) => e.stopPropagation()}>
            <div className="container">
              {/* print-index kicker — the overlay reads as a catalogue index, not a generic search box */}
              <div className="srch-kicker"><span className="ed-kicker-mark" aria-hidden="true" />Catalogue index</div>
              <form className="search-form" onSubmit={submitQ}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flex: "none", color: "var(--muted)" }}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input autoFocus placeholder="Search the catalogue…" value={q} onChange={(e) => onQ(e.target.value)} aria-label="Search products" autoCapitalize="none" spellCheck={false} />
                <button type="button" className="icon-btn" aria-label="Close search" onClick={() => setSearchOpen(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </form>
              {sugg === null && q.trim().length < 2 && <div className="search-hint" style={{ padding: "16px 2px 0" }}>Popular right now — type 2+ letters</div>}
              {fetching && <div className="search-hint" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 2px 0" }}><span className="spinner" aria-hidden="true" /> Searching…</div>}
              {sugg !== null && (
                <>
                  <div className="eyebrow" style={{ margin: "18px 0 8px" }}>{q.trim().length >= 2 ? (sugg.length ? "Products" : "") : "Popular right now"}</div>
                  {q.trim().length >= 2 && sugg.length === 0 && <div className="search-hint" style={{ padding: "6px 2px" }}>“{q}” khuje kichu pawa gelo na — spelling check korun</div>}
                  <div className="search-results">
                    {sugg.slice(0, 6).map((p) => (
                      <Link key={p.id} href={"/products/" + p.slug} onClick={() => { setSearchOpen(false); if (q.trim().length >= 2) trackEvent("Search", { search_string: q }); }}>
                        {p.image && <img src={p.image} alt="" />}
                        <div style={{ flex: 1 }}><div className="st">{p.title}</div></div>
                        {p.price != null && <div className="sp">৳{Number(p.price).toLocaleString("en-IN")}</div>}
                      </Link>
                    ))}
                  </div>
                  {q.trim().length >= 2 && sugg.length > 0 && (
                    <Link className="btn btn-outline search-all" href={"/products?q=" + encodeURIComponent(q.trim())} onClick={() => { setSearchOpen(false); trackEvent("Search", { search_string: q }); }}>
                      View all results →
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Footer({ cfg }: { cfg: any }) {
  const store = cfg?.store || {};
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subscribing) return;
    setSubscribing(true);
    try {
      const r = await fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (r.ok) { setMsg("Thank you — you're on the list."); setEmail(""); trackEvent("Lead", { content_name: "newsletter" }); }
      else setMsg("Please enter a valid email.");
    } catch { setMsg("Something went wrong."); }
    setSubscribing(false);
  };
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="logo" style={{ fontSize: 22 }}>{store.name}</div>
            <p className="about">{store.footerText}</p>
          </div>
          <div>
            <h4>Shop</h4>
            {(cfg?._nav?.categories || []).slice(0, 5).map((c: any) => (
              <Link prefetch key={c.slug} href={"/products?category=" + c.slug}>{c.name}</Link>
            ))}
            <Link prefetch href="/products">All Products</Link>
          </div>
          <div>
            <h4>Help</h4>
            <Link prefetch href="/track">Track Order</Link>
            <Link prefetch href="/returns#delivery">Shipping</Link>
            <Link prefetch href="/returns">Returns &amp; Exchange</Link>
            <Link prefetch href="/blog">Journal</Link>
            <a href={store.whatsapp ? waLink(store.whatsapp) : "#"} target="_blank" rel="noreferrer noopener">WhatsApp Support</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href={"mailto:" + store.email}>{store.email}</a>
            <a href={telLink(store.phone)}>{store.phone}</a>
            <a href={store.facebook} target="_blank" rel="noreferrer">Facebook</a>
            <a href={store.instagram} target="_blank" rel="noreferrer">Instagram</a>
          </div>
        </div>
      </div>
      <div className="newsletter">
        <div className="container nl-grid">
          <div>
            <div className="eyebrow" style={{ opacity: .75 }}>Newsletter</div>
            <h2>Join the {store.name || "TRENDING'S"} list</h2>
            <p>Early access to drops, private sales, and 10% off your first order.</p>
          </div>
          <div>
            <form onSubmit={subscribe}>
              <input type="email" required placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" disabled={subscribing} />
              <button type="submit" disabled={subscribing} aria-busy={subscribing || undefined}>
                {subscribing ? <span className="spinner" aria-hidden="true" /> : "Subscribe →"}
              </button>
            </form>
            {msg && <div className="form-note">{msg}</div>}
          </div>
        </div>
      </div>
      <div className="container">
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {store.name}. All rights reserved.</span>
          <span>Cash on Delivery across Bangladesh · {store.address}</span>
        </div>
      </div>
    </footer>
  );
}
