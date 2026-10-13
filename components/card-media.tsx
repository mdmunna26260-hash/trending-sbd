"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import CardGallery from "./card-gallery";
import CardImg from "./card-img";
import { FEATURES } from "@/lib/features";
import SegmentedProgress from "./segmented-progress";

/* The card's media block: the product photo(s) plus the segmented image progress bar that sits
   UNDER the image. Each photo gets one thin segment, and swiping fills the segment for the
   currently visible photo.

   Why the progress bar lives here and not inside CardGallery: `.pcard-img` clips its content
   (`overflow: hidden`, needed by the sliding track), so anything drawn "below the image"
   has to be a sibling of that box. The gallery reports its index up (`onIndexChange`) and
   this wrapper draws the bar, so it can never be cropped or sit on top of the photo.

   The bar is decoration, never buttons — the whole card is one <a>, and an <a> may not
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
        <SegmentedProgress count={pics.length} activeIndex={i} className="pcard-progress" />
      )}
    </div>
  );
}
