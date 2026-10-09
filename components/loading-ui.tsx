"use client";
import type { CSSProperties } from "react";

/* ============================================================
   TRENDING'S loading system — one shared, premium, minimal kit.
   - <Spinner/>          inline spinner for actions (currentColor)
   - <LoadingButton/>    button with busy state (disabled + spinner,
                         no width jump, no duplicate submits)
   - Skeleton family     layout-mirroring placeholders (pure markup,
                         CSS shimmer, respects prefers-reduced-motion)
   Only rendered when something is ACTUALLY loading — no fake delays.
   ============================================================ */

export function Spinner({ size = 15, className = "" }: { size?: number; className?: string }) {
  return <span className={"spinner " + className} style={{ width: size, height: size }} aria-hidden="true" />;
}

/* Action button: disabled + spinner + label while busy. Keeps its own
   dimensions (width comes from layout, spinner is inline). */
export function LoadingButton({
  busy, loadingLabel, children, className = "btn", style, ...rest
}: {
  busy: boolean; loadingLabel?: string; children: React.ReactNode;
  className?: string; style?: CSSProperties;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={className} style={style} disabled={busy || rest.disabled} aria-busy={busy || undefined}
      onClick={rest.onClick} type={rest.type || "button"}>
      {busy && <Spinner />}
      <span style={busy ? { marginLeft: 8 } : undefined}>{busy ? (loadingLabel || children) : children}</span>
    </button>
  );
}

/* ---------------- Skeleton primitives ---------------- */

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={"sk " + className} style={style} />;
}

/* Mirrors ProductCard: image aspect + title + category + price (+ old price) */
export function ProductCardSkeleton() {
  return (
    <div className="pcard" aria-hidden="true">
      <div className="pcard-img" style={{ background: "transparent" }}>
        <Skeleton className="sk-img" />
      </div>
      <div className="pcard-info">
        <Skeleton className="sk-line" style={{ width: "68%", marginBottom: 10 }} />
        <Skeleton className="sk-line sm" />
        <Skeleton className="sk-line" style={{ width: 84, marginTop: 10 }} />
      </div>
    </div>
  );
}

/* Same responsive template as .sk-grid (2/3/4/5 cols) → no layout shift */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="sk-grid" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => <ProductCardSkeleton key={i} />)}
    </div>
  );
}

/* Mirrors the PDP: breadcrumb, gallery+thumbs, title, price+off, sizes,
   qty, action buttons, description, meta */
export function ProductDetailsSkeleton() {
  return (
    <div className="container" aria-busy="true">
      <div style={{ padding: "22px 0 0" }}><Skeleton className="sk-line" style={{ width: 230 }} /></div>
      <div className="pdp-sk" style={{ padding: "24px 0 60px" }}>
        <div>
          <Skeleton className="sk-img" />
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} style={{ width: 60, height: 78 }} />)}
          </div>
        </div>
        <div>
          <Skeleton className="sk-line sm" style={{ width: 90 }} />
          <Skeleton className="sk-line" style={{ width: "78%", height: 26, marginTop: 14 }} />
          <Skeleton className="sk-line" style={{ width: "46%", height: 26 }} />
          <Skeleton className="sk-line" style={{ width: 120, height: 20, marginTop: 16 }} />
          <Skeleton className="sk-line sm" style={{ width: "70%", marginTop: 14 }} />
          <div style={{ display: "flex", gap: 10, margin: "18px 0 4px" }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ width: 52, height: 44 }} />)}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <Skeleton style={{ width: 120, height: 46 }} />
            <Skeleton style={{ width: 44, height: 46 }} />
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
            <Skeleton className="sk-btn" style={{ flex: 1, marginTop: 0 }} />
            <Skeleton className="sk-btn" style={{ flex: 1, marginTop: 0 }} />
          </div>
          <Skeleton className="sk-line sm" style={{ width: "62%", marginTop: 24 }} />
          <Skeleton className="sk-line sm" style={{ width: "48%" }} />
          <Skeleton className="sk-line sm" style={{ width: "55%" }} />
        </div>
      </div>
    </div>
  );
}

/* Category tiles (aspect 4/5) */
export function CategorySkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-3" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} style={{ aspectRatio: "4 / 5" }} />)}
    </div>
  );
}

/* Sidebar filter block */
export function FilterSkeleton() {
  return (
    <div aria-busy="true">
      {["Categories", "Price", "Size"].map((_, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <Skeleton className="sk-line" style={{ width: 90 }} />
          <Skeleton className="sk-line sm" style={{ width: "80%" }} />
          <Skeleton className="sk-line sm" style={{ width: "62%" }} />
        </div>
      ))}
    </div>
  );
}

/* Admin table rows (orders / products / customers) */
export function TableRowSkeleton({ cols = 5, rows = 6, image = false }: { cols?: number; rows?: number; image?: boolean }) {
  return (
    <div aria-busy="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #f1efec" }}>
          {image && <Skeleton style={{ width: 40, height: 50, borderRadius: 4 }} />}
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="sk-line" style={{ margin: 0, width: c === 0 ? "22%" : `${Math.max(10, 60 / cols)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* Admin dashboard: KPI cards + main panel */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="sk-line" style={{ width: 170, height: 22 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, margin: "20px 0 22px" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi">
            <Skeleton className="sk-line sm" style={{ width: "55%" }} />
            <Skeleton className="sk-line" style={{ width: "40%", height: 22, marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div className="acard">
        <div style={{ padding: "15px 20px", borderBottom: "1px solid #eeedea" }}>
          <Skeleton className="sk-line" style={{ width: 130 }} />
        </div>
        <TableRowSkeleton cols={5} rows={7} />
      </div>
    </div>
  );
}

/* Generic image block */
export function ImageSkeleton({ ratio = "3 / 4", height }: { ratio?: string; height?: number | string }) {
  return <Skeleton className="sk-img" style={height ? { height } : { aspectRatio: ratio.replace(" / ", " / ") }} />;
}
