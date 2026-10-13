"use client";
import { useEffect } from "react";

/* Page transition behaviour.
   The shared-element morph used to live here (components/view-transition.ts); it has been
   removed in favour of route-level skeleton loading. All remaining transition styles live
   statically in globals.css (the pageIn keyframes) — no runtime style injection, zero
   per-load JS work. This component only handles scroll restoration. */
export default function PageTransition() {
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);
  return null;
}
