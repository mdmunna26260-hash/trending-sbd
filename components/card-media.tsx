"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import CardGallery from "./card-gallery";
import CardImg from "./card-img";
import { FEATURES } from "@/lib/features";
import CarouselDots from "./carousel-dots";

/* The card's media block: the product photo(s) plus the carousel dots that sit UNDER the
   image. Each photo gets one dot, and swiping moves the filled dot to the visible photo.

   Why the dots live here and not inside CardGallery: `.pcard-img` clips its content
   (`overflow: hidden`, needed by the sliding track), so anything drawn "below the image"
   has to be a sibling of that box. The gallery reports its index up (`onIndexChange`) and
   this wrapper draws the dots, so they can never be cropped or sit on top of the photo.

   The dots are decoration, never buttons — the whole card is one <a>, and an <a> may not
   contain interactive elements. Tapping the row therefore opens the product, like the
   rest of the card. */
export default function CardMedia({ images, image, alt, slug, children }: {
  images?: string[]; image?: string; alt: string; slug?: string; children?: ReactNode;
}) {
  const pics = (images || []).filter(Boolean);
  const [i, setI] = useState(0);
  const swipeEnabled = FEATURES.cardImageSwipe && pics.length > 1;
  const coverUrl = image || pics[0];
  return (
    <div className="pcard-media">
      {/* `children` = the badges, which must stay inside the clipped image box */}
      <div className="pcard-img">
        {swipeEnabled
          ? <CardGallery images={pics} alt={alt} onIndexChange={setI} />
          : coverUrl ? <CardImg url={coverUrl} alt={alt} slug={slug} /> : null}
        {children}
      </div>
      {swipeEnabled && (
        <CarouselDots count={pics.length} activeIndex={i} className="pcard-progress" />
      )}
    </div>
  );
}
