"use client";
import { useEffect, useRef, useState } from "react";
import { imgSrc } from "./img-src";

/* Banner image (hero / promo) with responsive variants + broken-image fallback.
   - srcset for /api/media/ and /uploads/seed/ URLs → mobile downloads a
     ~600-1000px WebP instead of the full-size original (big LCP win).
   - subtle fade-in on decode; `v` (cache-bust) changes when admin saves. */
export default function SmartImg({ src, alt, className, fallback = "/uploads/seed/hero.jpg", priority, sizes = "100vw", widths = [600, 1000] }: {
  src?: string; alt: string; className?: string; fallback?: string; priority?: boolean;
  /* The rendered width of the placement. Without these every SmartImg claimed 100vw, so a
     190px category tile on a phone asked for the 1200px variant - 6x the pixels it can show. */
  sizes?: string; widths?: number[];
}) {
  const [cur, setCur] = useState(src);
  const [dead, setDead] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { setCur(src); setDead(false); setLoaded(false); }, [src]);
  useEffect(() => { if (ref.current?.complete) setLoaded(true); }, [cur]);
  if (!src || dead) return null; // section gracefully hides (homepage checks src anyway)
  // imgSrc keeps the cache-buster query on every candidate automatically
  /* Only advertise candidates that actually differ. When a source is already a resized asset
     (e.g. /uploads/seed/x-600.webp) imgSrc cannot build a per-width URL and returns the same file
     for every width — a srcset of "x-600.webp 300w, x-600.webp 600w, x-600.webp 1000w" would then
     tell the browser the 600px file is a 1000px one. Wrong descriptors are worse than no srcset. */
  const seen = new Set<string>();
  const cand = widths
    .map((n) => ({ n, url: imgSrc(cur, n) }))
    .filter(({ url }) => { if (!url || seen.has(url)) return false; seen.add(url); return true; });
  const srcSet = cand.length > 1 ? cand.map(({ n, url }) => `${url} ${n}w`).join(", ") : undefined;
  return (
    <>
      {/* Same skeleton the product cards and galleries use. Hero/banners are the largest
          images on the page, so on a mobile connection this is the one the shopper actually
          waits for — a shimmer reads as "loading" where a blank box reads as "broken". */}
      {!loaded && <div className={"sk sk-fill" + (className ? " " + className : "")} aria-hidden="true" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={priority ? cur : cand[0].url}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        className={className ? className + " fade-img" + (loaded ? " loaded" : "") : "fade-img" + (loaded ? " loaded" : "")}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        onLoad={() => setLoaded(true)}
        onError={() => { if (cur !== fallback) setCur(fallback); else setDead(true); }}
        style={{ position: "relative", zIndex: 1 }}
      />
    </>
  );
}
