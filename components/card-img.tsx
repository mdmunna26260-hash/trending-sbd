"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { imgSrc, imgSrcSet, CARD_WIDTHS, CARD_SIZES } from "./img-src";
import { warmImage, warmWhenIdle } from "./img-warm";

/* Neutral placeholder if a product image ever fails to load (keeps layout) */
const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#eee9e2"/><path d="M110 265l45-55 35 40 30-32 50 47v60H90z" fill="#d8d2c8"/><circle cx="185" cy="140" r="22" fill="#d8d2c8"/></svg>`
  );

/* Product-card image.
   - responsive srcset, lazy
   - subtle fade-in the moment the image is decoded (fixed box → zero CLS)
   - clean fallback on error
   - idle warming (visible cards pre-heat their PDP image)
   - hover/touch intent → warm image + prefetch PDP route */
export default function CardImg({ url, alt, slug }: { url: string; alt: string; slug?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const router = useRouter();
  const routed = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);

  // images restored from browser cache can finish BEFORE hydration → onLoad missed
  useEffect(() => { if (ref.current?.complete) setLoaded(true); }, []);

  const onIntent = () => {
    warmImage(url);
    if (slug && !routed.current) {
      routed.current = true;
      /* The route prefetch is a router-state update, i.e. a render of the app tree. On a phone
         this runs in the middle of the tap (touchstart → touchend, and the click the browser is
         about to synthesize for the product link). WebKit drops that click when the tree under
         the finger re-renders, which is the "single tap er bodole 2 bar tap" report — so the
         prefetch is deferred out of the touch task; the image warming above still happens now. */
      const go = () => router.prefetch("/products/" + slug);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
      else setTimeout(go, 0);
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !done) {
          done = true;
          io.disconnect();
          warmWhenIdle(url, 500); // stagger: let the card's own image load first
        }
      }
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [url]);

  return (
    <>
      {/* Skeleton shimmer while the bitmap decodes. The box already has a fixed
          aspect-ratio + background (.pcard-img), so this paints inside it and adds no CLS;
          it unmounts on load instead of relying on :has(), which would leave the shimmer
          stuck forever on a browser that lacks the selector. */}
      {!loaded && !err && <div className="sk sk-fill" aria-hidden="true" />}
      <img
        ref={ref}
        src={err ? FALLBACK : imgSrc(url, 400)}
        srcSet={err ? undefined : imgSrcSet(url, CARD_WIDTHS)}
        sizes={CARD_SIZES}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={"fade-img" + (loaded ? " loaded" : "")}
        onLoad={() => setLoaded(true)}
        onError={() => { setErr(true); setLoaded(true); }}
        onPointerEnter={onIntent}
        onTouchStart={onIntent}
        style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative", zIndex: 1 }}
      />
    </>
  );
}
