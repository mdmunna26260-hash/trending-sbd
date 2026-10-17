"use client";

type Props = {
  count: number;
  activeIndex: number;
  className?: string;
  onSelect?: (index: number) => void;
  label?: string;
};

/* Carousel dots — one dot per photo, the active one filled.

   This replaces the old segmented progress bar (one stretched thin line per photo). The API is
   unchanged so cards, the PDP gallery and the mobile gallery all keep working: pass `onSelect`
   and the dots become tappable controls, omit it and they stay decoration.

   On a product card they must stay decoration: the whole card is one <a>, and an <a> may not
   contain interactive elements. */
export default function CarouselDots({
  count,
  activeIndex,
  className = "",
  onSelect,
  label = "Image pagination",
}: Props) {
  if (count <= 1) return null;

  const current = Math.min(Math.max(activeIndex, 0), count - 1);
  const interactive = typeof onSelect === "function";

  return (
    <div
      className={["carousel-dots", className].filter(Boolean).join(" ")}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? label : undefined}
      aria-hidden={interactive ? undefined : true}
    >
      {Array.from({ length: count }, (_, index) => {
        const dotClass = "carousel-dot" + (index === current ? " is-active" : "");
        return interactive ? (
          <button
            key={index}
            type="button"
            className={dotClass}
            aria-label={`Show image ${index + 1}`}
            aria-current={index === current ? "step" : undefined}
            onClick={() => onSelect(index)}
          />
        ) : (
          <span key={index} className={dotClass} aria-hidden="true" />
        );
      })}
    </div>
  );
}
