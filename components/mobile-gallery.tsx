"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { imgSrc, imgSrcSet, PDP_WIDTHS, PDP_SIZES, PDP_SRC_WIDTH, THUMB_WIDTHS } from "./img-src";
import { warmImage } from "./img-warm";
import SegmentedProgress from "./segmented-progress";

type Img = { url: string; alt: string };

/* Premium mobile swipe gallery (PacSun-style interaction, TRENDING'S identity):
   - Track follows the finger 1:1 (translate3d, GPU)
   - Release: momentum decides next/previous; short drags spring back
   - 320ms cubic-bezier slide, no library
   - Fixed aspect-ratio container → zero layout jump
   - object-fit: contain → original aspect preserved, no distortion
   - Skeleton + subtle fade-in per image; neighbours preloaded
   - Vertical page scroll stays natural (axis lock) */

export default function MobileGallery({ images, title, active, onIndexChange }: {
  images: Img[]; title: string; active: number; onIndexChange: (i: number) => void;
}) {
  const N = images.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startX: 0, startY: 0, dx: 0, locked: false as false | "x" | "y", t0: 0 });
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});

  const W = 100; // percent per slide

  const slideTo = useCallback((i: number, animate = true) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 320ms cubic-bezier(.22,.61,.36,1)" : "none";
    el.style.transform = `translate3d(-${i * W}%,0,0)`;
  }, []);

  // keep track in sync when index changes from outside (progress bar/thumbs)
  useEffect(() => { if (!dragging) slideTo(active); }, [active, dragging, slideTo]);

  // keep the active thumbnail scrolled into view (strip scrolls, page never jumps)
  const thumbsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = thumbsRef.current;
    if (!strip) return;
    const el = strip.children[active] as HTMLElement | undefined;
    if (!el) return;
    strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [active]);

  /* Only the slides the shopper has actually reached get an <img>: a `loading="lazy"` image inside
     a horizontal track is still fetched while its slide sits off-screen, so a 5-photo product paid
     for several full-size files before the shopper swiped once.
     The set starts with the first three slides and only ever GROWS — a slide that has been paid for
     is never unmounted, so it is never re-requested. active ± 1 is what the pre-warm effect below
     keeps warm, so the next swipe finds it already in the browser cache. */
  const [seen, setSeen] = useState<number[]>(() => [0, 1, 2].filter((i) => i < N));
  useEffect(() => {
    setSeen((s) => {
      const want = [active - 1, active, active + 1].filter((i) => i >= 0 && i < N);
      const missing = want.filter((i) => !s.includes(i));
      return missing.length ? [...s, ...missing].sort((a, b) => a - b) : s;
    });
  }, [active, N]);

  // preload neighbours for instant swipe feel
  useEffect(() => {
    [active - 1, active + 1].forEach((i) => {
      const im = images[((i % N) + N) % N];
      if (im) warmImage(im.url);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    drag.current = { startX: t.clientX, startY: t.clientY, dx: 0, locked: false, t0: Date.now() };
    setDragging(true);
    const el = trackRef.current;
    if (el) {
      // freeze current position without transition for 1:1 finger tracking
      el.style.transition = "none";
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d.startX) return;
    const t = e.touches[0];
    const dx = t.clientX - d.startX;
    const dy = t.clientY - d.startY;
    if (!d.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // axis lock: whichever comes first wins — vertical never hijacked
      d.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (d.locked !== "x") return;
    d.dx = dx;
    // rubber-band at the ends
    let offset = dx;
    if ((active === 0 && dx > 0) || (active === N - 1 && dx < 0)) offset = dx * 0.35;
    setDragDx(offset);
    const el = trackRef.current;
    if (el) el.style.transform = `translate3d(calc(-${active * W}% + ${offset}px),0,0)`;
  };

  const onTouchEnd = () => {
    const d = drag.current;
    setDragging(false);
    if (d.locked === "x" && d.dx) {
      const dt = Math.max(1, Date.now() - d.t0);
      const velocity = d.dx / dt; // px/ms
      const threshold = 60; // px, or fast flick
      if (d.dx < -threshold || velocity < -0.5) {
        if (active < N - 1) { onIndexChange(active + 1); setDragDx(0); return; }
      } else if (d.dx > threshold || velocity > 0.5) {
        if (active > 0) { onIndexChange(active - 1); setDragDx(0); return; }
      }
    }
    // spring back / commit current
    setDragDx(0);
    slideTo(active);
  };

  // A product created in Admin before any photo is attached has images.length === 0.
  // The track then renders an empty 3:4 hole and the PDP looks broken, so show a labelled
  // placeholder of exactly the same height (no layout jump when the photo is uploaded later).
  if (!N) {
    return (
      <div className="mgal" aria-label={`${title} — no photo yet`}>
        {/* .mgal-viewport is the element that carries the 3:4 box + background, so reusing it keeps the
            placeholder exactly the size of a real slide (and it stays right when a photo is added). */}
        <div className="mgal-viewport noimg" data-vt-hero>
          <span className="noimg-in"><span className="noimg-mark" aria-hidden>S</span><span>No photo yet</span></span>
        </div>
      </div>
    );
  }

  // counter animates via CSS; container has fixed aspect-ratio → no height jump
  return (
    <div className="mgal" aria-roledescription="carousel" aria-label={`${title} images`}>
      <div
        className="mgal-viewport"
        data-vt-hero
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className={"mgal-track" + (dragging ? " dragging" : "")} ref={trackRef}>
          {images.map((im, i) => (
            <div className="mgal-slide" key={i}>
              {!loaded[i] && <div className="sk sk-img" style={{ position: "absolute", inset: 0 }} />}
              {seen.includes(i) && <img
                /* Same ladder + same rendered-width hint as the desktop gallery and the document
                   preload — all three read these constants (see components/img-src.ts). */
                src={imgSrc(im.url, PDP_SRC_WIDTH) || im.url}
                srcSet={imgSrcSet(im.url, PDP_WIDTHS)}
                sizes={PDP_SIZES}
                alt={im.alt || `${title} — image ${i + 1}`}
                draggable={false}
                loading={i === 0 ? "eager" : "lazy"}
                decoding={i === active ? "sync" : "async"}
                onLoad={() => setLoaded((l) => ({ ...l, [i]: true }))}
                className={"mgal-img" + (loaded[i] ? " loaded" : "")}
              />}
            </div>
          ))}
        </div>
      </div>

      {/* Thin segmented progress bar BELOW the image: one segment per photo, with the active
          segment filled. Tapping a segment jumps directly to that image. */}
      {N > 1 && (
        <SegmentedProgress
          count={N}
          activeIndex={active}
          className="mgal-progress"
          onSelect={onIndexChange}
        />
      )}

      {/* thumbnail strip — tap to jump, active highlighted, auto-centred */}
      {N > 1 && (
        <div className="mgal-thumbs" ref={thumbsRef} role="tablist" aria-label="Image thumbnails">
          {images.map((im, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              aria-label={`Image ${i + 1}`}
              className={i === active ? "on" : ""}
              onClick={() => onIndexChange(i)}
            >
              <img
                src={imgSrc(im.url, 200) || im.url}
                srcSet={imgSrcSet(im.url, THUMB_WIDTHS)}
                sizes="56px"
                alt=""
                loading={Math.abs(i - active) <= 1 ? "eager" : "lazy"}
                decoding="async"
                width={56}
                height={70}
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
