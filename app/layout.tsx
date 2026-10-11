import type { Metadata, Viewport } from "next";
import "./globals.css";
import RevealInit from "@/components/reveal";
import PageViewTracker from "@/components/pageview";
import PageTransition from "@/components/page-transition";
import ViewTransitionRoot from "@/components/view-transition-root";
import { CartProvider } from "@/components/store";
import PushRegister from "@/components/push-register";
import PushNudge from "@/components/push-nudge";
import { getSettings, publicSettings } from "@/lib/settings";
import { clean } from "@/lib/search";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  /* browser chrome follows the paper/ink pair (was a single hard-coded cream) */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#14120f" },
  ],
};

/* Share images: use the 1200px variant instead of the full-res original */
const ogImage = (u?: string) => {
  const m = /^\/api\/media\/([a-z0-9]+)$/i.exec(u || "");
  return m ? `/api/media/${m[1]}/w1200` : u;
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const s = publicSettings(await getSettings());
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "";
    return {
      // without metadataBase every absolute share URL (og:image, canonical) silently
      // resolves to nothing — Facebook/WhatsApp then show no preview picture
      metadataBase: new URL(siteUrl ? (siteUrl.startsWith("http") ? siteUrl : "https://" + siteUrl) : "https://sinzooffcial.com"),
      title: {
        default: clean(s.seo?.metaTitle) || `${s.store?.name || "Store"} — ${clean(s.store?.tagline) || "Shop online, pay on delivery"}`,
        template: `%s · ${s.store?.name || "Store"}`,
      },
      description: clean(s.seo?.metaDescription) || clean(s.store?.tagline) || "",
      // one canonical host: http/https/www variants otherwise all get indexed
      alternates: { canonical: "/" },
      robots: {
        index: true, follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
      },
      openGraph: {
        type: "website",
        siteName: s.store?.name || "Store",
        locale: "en_BD",
        url: (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "") + "/",
        title: clean(s.seo?.metaTitle) || s.store?.name,
        description: clean(s.seo?.metaDescription) || clean(s.store?.tagline) || "",
        images: s.homepage?.heroImage ? [ogImage(s.homepage.heroImage)] : [],
      },
    };
  } catch { return { title: "Store" }; }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let cfg: any = null;
  try { cfg = publicSettings(await getSettings()); } catch {}
  const theme = cfg?.theme || {};
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");
  const orgLd = cfg?.store?.name ? {
    "@context": "https://schema.org",
    "@graph": [
    {
      "@type": "Organization",
      "@id": siteBase + "/#organization",
      name: cfg.store.name,
      url: siteBase + "/",
      ...(cfg.store.logo ? { logo: cfg.store.logo } : {}),
      ...(cfg.store.email ? { email: cfg.store.email } : {}),
      ...(cfg.store.phone ? { telephone: cfg.store.phone } : {}),
      ...(cfg.store.address ? { address: { "@type": "PostalAddress", streetAddress: cfg.store.address } } : {}),
      sameAs: [cfg.store?.facebook, cfg.store?.instagram, cfg.store?.tiktok, cfg.store?.youtube].filter(Boolean),
    },
    {
      "@type": "WebSite",
      "@id": siteBase + "/#website",
      url: siteBase + "/",
      name: cfg.store.name,
      description: cfg.store?.tagline || undefined,
      publisher: { "@id": siteBase + "/#organization" },
      inLanguage: ["en", "bn"],
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: siteBase + "/products?q={search_term_string}" },
        "query-input": "required name=search_term_string",
      },
    },
    ],
  } : null;
  // Maintenance mode: block storefront for non-admins (admins keep full access)
  let adminBypass = false;
  try {
    const { getSessionUser } = await import("@/lib/auth");
    adminBypass = !!(await getSessionUser());
  } catch {}
  if (cfg?.maintenance?.enabled && !adminBypass) {
    const store = cfg.store || {};
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{var m=localStorage.getItem("sz_theme")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();` }} />
          <style dangerouslySetInnerHTML={{ __html: `:root{--bg:${theme.bg || "#faf9f7"};--text:${theme.text || "#141414"};}` }} />
        </head>
        <body>
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "var(--bg)", color: "var(--text)" }}>
            <div className="logo" style={{ fontSize: 30, letterSpacing: "0.3em" }}>{store.name || "STORE"}</div>
            <h1 style={{ fontFamily: "var(--font-head)", fontSize: 32, margin: "30px 0 10px" }}>We&apos;re doing a little maintenance.</h1>
            <p style={{ color: "#6f6a63", maxWidth: 420 }}>{cfg.maintenance.message || "We'll be back soon."}</p>
            {store.facebook && <a href={store.facebook} style={{ marginTop: 18, borderBottom: "1px solid" }}>Follow us for updates</a>}
          </div>
        </body>
      </html>
    );
  }
  const cssVars = `
    :root {
      ${theme.bg ? `--bg:${theme.bg};` : ""}
      ${theme.text ? `--text:${theme.text};` : ""}
      ${theme.accent ? `--accent:${theme.accent};` : ""}
      ${theme.headingFont ? `--font-head:${theme.headingFont};` : ""}
      ${theme.bodyFont ? `--font-body:${theme.bodyFont};` : ""}
      ${theme.radius != null ? `--radius:${theme.radius}px;` : ""}
      ${theme.productImageRatio ? `--img-ratio:${String(theme.productImageRatio).replace(":", " / ")};` : "--img-ratio:3 / 4;"}
      ${theme.containerWidth ? `--container:${theme.containerWidth}px;` : ""}
    }`;
  const rawGtmId = String(cfg?.integrations?.gtmId || "").trim();
  const gtmId = /^GTM-[A-Z0-9]{4,16}$/i.test(rawGtmId) ? rawGtmId : "";
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var m=localStorage.getItem("sz_theme")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();` }} />
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
        {/* both faces paint above the fold (hero headline + body copy) — warm them in parallel */}
        <link rel="preload" href="/fonts/anton-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/archivo-var.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* without an explicit 32px/ico entry browsers request /favicon.ico and got a 19 KB
            HTML 404 page back (that response is also uncacheable, so it repeats on every visit) */}
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon-48.png" sizes="48x48" type="image/png" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
        <link rel="mask-icon" href="/icon-192.png" color="#14120f" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* theme-color lives in the `viewport` export above (light paper / dark ink) */}
        {/* No font preconnect or stylesheet on purpose: the theme heading/body fonts are a <select> of
            system stacks (Didot/Bodoni/Georgia plus the UI sans), so nothing is ever downloaded from
            Google. The old preconnect was a free DNS+TCP+TLS round trip on every view. If a real webfont
            is added later, put the preconnect and the stylesheet link back in together. */}
        {gtmId ? (
          <script id="gtm" dangerouslySetInnerHTML={{ __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');` }} />
        ) : null}
        <script id="sz-cfg" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(cfg || {}).replace(/</g, "\\u003c") }} />
        {orgLd ? (
          /* Entity + sitelinks-searchbox markup for the whole site (the PDP has Product
             schema, but "/" had no structured data at all → no knowledge panel, no
             sitelinks search box, and brand queries show a bare listing). */
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd).replace(/</g, "\\u003c") }} />
        ) : null}
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `(function(){
  try{
    var K="sz_chunk_err", MAX=5, GAP=60000;
    /* A rebuilt bundle under an open tab is the one crash we cannot prevent: the page in memory
       asks for a module that no longer exists in the chunk it loads and webpack throws
       "Cannot read properties of undefined (reading 'call')". This used to be handled once per
       tab, so a tab that had already been healed once sat on a half-broken page (or the Oops
       card) afterwards. Now the reload budget is time-based: one reload per minute, at most five
       per tab — enough to walk out of any rebuild or deploy, never a reload loop. */
    var used=function(){try{return JSON.parse(sessionStorage.getItem(K)||"null")||{n:0,at:0};}catch(e){return {n:0,at:0};}};
    var heal=function(m){
      try{ fetch("/api/client-error",{method:"POST",headers:{"Content-Type":"application/json"},keepalive:true,
             body:JSON.stringify({message:m,url:location.pathname+location.search})}).catch(function(){}); }catch(e){}
      var s=used(), now=Date.now();
      if(s.n>=MAX||now-(s.at||0)<GAP) return;            /* budget spent — leave the page alone */
      try{ sessionStorage.setItem(K,JSON.stringify({n:s.n+1,at:now})); }catch(e){}
      setTimeout(function(){
        try{var u=new URL(location.href);
            if(!u.searchParams.has("_r")){u.searchParams.set("_r",String(Date.now()));location.replace(u.toString());return;}}catch(e){}
        location.reload();
      },50);
    };
    /* components/safe-section.tsx catches a section-level failure so the rest of the page can
       still render — but if that failure is the bundle itself, the section would just vanish.
       Expose the heal so a missing section can also walk the tab back to a consistent build. */
    window.__szHeal=heal;
    window.addEventListener("error",function(e){
      var s=e&&e.target&&e.target.src||"";
      if(s&&s.indexOf("/_next/")>-1){ heal("chunk load fail: "+s.split("/").pop()); return; }
      var m=String(e&&e.message||"");
      if(m.indexOf("reading 'call'")>-1) heal("stale bundle: "+m.slice(0,120)+" @ "+String(e&&e.filename||"").split("/").pop());
    },true);
    window.addEventListener("unhandledrejection",function(e){
      var m=String(e&&e.reason&&e.reason.message||e&&e.reason||"");
      if(m.indexOf("dynamically imported module")>-1||m.indexOf("Loading chunk")>-1||m.indexOf("ChunkLoadError")>-1) heal("chunk reject: "+m.slice(0,200));
    });
  }catch(e){}
})();` }} />
        <CartProvider>
        {/* Reading-progress bar for the whole storefront. `animation-timeline: scroll(root)` in
            globals.css drives it — no JS scroll listener, and browsers without the feature never
            show it (display:none until @supports matches). The admin panel has its own layout and
            is excluded by `body:has(.admin-body)`. */}
        <div className="scroll-progress" aria-hidden />
        {children}
        </CartProvider>
        <PushRegister />
        <PushNudge />
        <RevealInit />
        <PageViewTracker />
        <PageTransition />
        <ViewTransitionRoot />
        {process.env.NODE_ENV === "development" && (
          /* Dev-preview self-heal. This sandbox restarts and takes the dev server with it, and a
             tab that is merely sitting there never hits the chunk-error reload above — it just keeps
             painting the last render forever (the "+" looks like the old "Add" pill, etc.). So poll
             quietly and reload ONCE on the down→up edge. Dev only: never emitted into the prod HTML,
             and the 15 s floor keeps a restart storm from reloading mid-typing. */
          <script dangerouslySetInnerHTML={{ __html: `(function(){var down=0,last=0;setInterval(function(){fetch(location.pathname,{method:"HEAD",cache:"no-store"}).then(function(r){if(down&&r.ok&&Date.now()-last>15000){last=Date.now();location.reload();}down=0;}).catch(function(){if(!down)down=Date.now();});},8000);})();` }} />
        )}
        <script dangerouslySetInnerHTML={{ __html: `history.scrollRestoration = 'manual';` }} />
      </body>
    </html>
  );
}
