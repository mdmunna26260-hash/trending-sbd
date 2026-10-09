"use client";
import { useEffect, useState } from "react";
import { FEATURES } from "@/lib/features";

/* Sold count — two modes:
   - "fixed":  show the exact admin-set number (classic behaviour)
   - "random": stable per-product base (deterministic from id) that SLOWLY
     grows: +1..3 on ~60% of visits, +1 every 45–90s while the page is open.
     Growth persists per browser (localStorage) so it keeps rising day over
     day: 958 → 961 → 965 → … next day still higher. */

function baseFor(id: number): number {
  return 500 + ((id * 137) % 4500); // 500..4999, stable per product
}

export default function SoldCount({ productId, soldCount, soldMode }: { productId: number; soldCount?: number | null; soldMode?: string | null }) {
  const [n, setN] = useState<number | null>(() => (soldMode === "random" ? null : soldCount && soldCount > 0 ? soldCount : null));

  useEffect(() => {
    if (!FEATURES.soldCount || soldMode !== "random") return;
    const base = baseFor(productId);
    const KEY = "sinzo_sold_" + productId;
    let acc = 0;
    try { acc = Number(localStorage.getItem(KEY)) || 0; } catch {}
    if (Math.random() < 0.6) {
      acc += 1 + Math.floor(Math.random() * 3); // +1..3 per visit
      acc = Math.min(acc, 3000);
      try { localStorage.setItem(KEY, String(acc)); } catch {}
    }
    setN(base + acc);
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      acc += 1;
      acc = Math.min(acc, 3000);
      try { localStorage.setItem(KEY, String(acc)); } catch {}
      setN(base + acc);
      t = setTimeout(tick, 45000 + Math.random() * 45000); // 45–90s
    };
    t = setTimeout(tick, 45000 + Math.random() * 45000);
    return () => clearTimeout(t);
  }, [productId, soldMode]);

  if (!FEATURES.soldCount || n == null || n <= 0) return null;
  return (
    <div className="pdp-sold" style={{ display: "flex", alignItems: "center", gap: 6, margin: "-2px 0 6px" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "rgba(154,123,79,.10)", padding: "4px 10px", borderRadius: 99 }}>
        Sold: {n.toLocaleString("en-IN")}
      </span>
    </div>
  );
}
