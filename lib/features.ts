/* -------------------------------------------------------------------------------------------------
   FEATURE VISIBILITY SWITCHES — "hidden", not deleted.
   -------------------------------------------------------------------------------------------------
   Kichu feature ekhon use hocche na, tai admin panel / storefront theke gayeb kora hoyeche. Code, DB
   table, API, worker — sob jaygay ache; sudhu ei file e `false` → `true` korlei feature ta abar
   poora ferot ashe (dev server restart / Vercel redeploy lagbe).

   Ekhon ki ki hidden (owner-r request):

     2026-10-08 (1st round):
     • adminEngagement    — sidebar er "Engagement" group: Reviews, SMS, Loyalty & Referral,
                            Marketing, Newsletter & Push, Blog (+ Settings → SMS gateway block)
     • adminWhatsapp      — sidebar er "WhatsApp" group: New message, New campaign, Broadcast &
                            Queue, Devices, Templates, Inbox (+ Settings er WhatsApp card / bridge
                            key / auto-reply / admin WA number, + /api/wa* endpoints)

     2026-10-08 (4th round):
     • freeDelivery       — free delivery er sob rasta bondho (threshold + coupon type + storefront promise)

     2026-10-08 (3rd round):
     • adminReviews       — Reviews `true` kora hoyeche (owner: "just reviews ta back ano"). Baki 5 ta
                            engagement tool hidden-i ache. Reviews abar hide korte: flag ta `false`.

     2026-10-08 (2nd round):
     • adminCampaignLinks — Growth tools → "Campaign links" page + /api/admin/links
     • adminTwoFactor     — 2FA: Security page er 2FA card + admin login er 2nd step. Login bypass
                            hoy (kono lockout nei) kintu DB te secret/recovery code muchhe jay na —
                            switch on korlei abar code chabe. Security page-er Sessions ("Log out
                            everywhere") + login history age er moto-i ache.
     • googleLogin        — customer "Continue with Google" button (login page), Settings →
                            Google (Gmail) Login card, ar /api/auth/google* endpoints

   Ki hoy na (icche kore):  storefront er baki sob (footer "WhatsApp Support" link, newsletter box,
   /blog, product reviews), order flow + WA queue row, waitlist notify logic, ar store-er public
   WhatsApp number field — age er moto-i ache. Kono code file, route, DB row ba worker delete hoy ni.

   Kothay enforce hoy (ek e list theke, tai kabhu alada hote parbe na):
     1. components/admin-sidebar.tsx          — nav theke item bad (+ "Security & 2FA" → "Security")
     2. middleware.ts                         — direct URL → /admin/dashboard redirect, API → 404
     3. lib/auth.ts  adminLanding()           — marketing-only role hidden page e jay na
     4. app/api/admin/login{,/2fa}/route.ts   — 2FA step off/bypass
     5. app/api/admin/security/route.ts       — 2FA setup/enable/disable/recovery actions refuse
     6. lib/settings.ts + app/login + Settings — Google login button/card/config off
   ------------------------------------------------------------------------------------------------- */

export const FEATURES = {
  /** Admin → Engagement group: SMS · Loyalty & Referral · Marketing · Newsletter & Push · Blog
      (Reviews ke owner 2026-10-08 e abar chaise — dekho niche `adminReviews`) */
  adminEngagement: false,
  /** Reviews — owner request: *"just reviews ta back ano"*. `true` = visible (ager moto).
      Abar hide korte hole sudhu ei line ta `false` korlei hobe — sidebar + middleware auto follow kore. */
  adminReviews: true,
  /** Admin → WhatsApp group: compose · campaigns · queue · devices · templates · inbox */
  adminWhatsapp: false,
  /** Growth tools → Campaign links (UTM builder) */
  adminCampaignLinks: false,
  /** Two-factor login + Security page er 2FA card (bypass, DB secret rakha ache) */
  adminTwoFactor: false,
  /** Customer login → "Continue with Google" + Settings card + /api/auth/google* */
  googleLogin: false,
  /** Free delivery — owner: *"free delivery charge option remove kore deo"*.
      Off ⇒ (a) threshold-based free shipping ar (b) coupon-er "Free shipping" type dutoi bondho,
      (c) Settings er "Free shipping over (৳)" field lukano, (d) cart/PDP/Returns er promise gayeb.
      Money er sotti `lib/checkout-pricing.ts` — oi function-i threshold+coupon ignore kore, tai
      purono DB value (5000) ba purono FREESHIP code diye-o free delivery paowa jabe na.
      DB te value/row rakha ache: switch on + coupon abar active korlei sob ferot. */
  freeDelivery: false,
  /** PDP "Sold: N" badge + Admin product editor Sold count (fixed/random) block */
  soldCount: false,
  /** Color Group / linked color products + variant linked color image */
  colorGroups: false,
  /** Product card horizontal drag-to-swipe gallery + segmented progress bar under card photo */
  cardImageSwipe: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

/* ---- what each switch hides -------------------------------------------------------------------
   Middleware, sidebar ar adminLanding — sob ei dui map theke pore, tai ek jaygay add korle
   sob jaygay apply hoy. Path match: exact ba tar niche (sub-route) — `/admin/blog/12` o dhora porbe.
   Khali list ([]) = oi switch-er jonno middleware/redirect kichu nei (page/API nijei guard kore). */

export const HIDDEN_ADMIN_PAGES: Record<FeatureKey, string[]> = {
  adminEngagement: [
    "/admin/sms",
    "/admin/loyalty",
    "/admin/marketing",
    "/admin/campaigns",   // Newsletter & Push
    "/admin/blog",
  ],
  adminWhatsapp: [
    "/admin/whatsapp",    // Broadcast & Queue + compose/new/[id] sub-routes
    "/admin/inbox",
  ],
  adminReviews: ["/admin/reviews"],
  adminCampaignLinks: ["/admin/links"],
  adminTwoFactor: [],     // Security page thake (Sessions + login history), sudhu 2FA card + login step off
  googleLogin: [],        // admin page nei — customer login page + settings card
  freeDelivery: [],       // route nei — pricing (lib/checkout-pricing.ts) + settings/coupon UI nijei guard kore
  soldCount: [],
  colorGroups: [],
  cardImageSwipe: [],
};

export const HIDDEN_ADMIN_APIS: Record<FeatureKey, string[]> = {
  adminEngagement: [
    "/api/admin/sms",
    "/api/admin/loyalty",
    "/api/admin/campaigns",
    "/api/admin/push",
    "/api/admin/blog",
  ],
  adminWhatsapp: [
    "/api/admin/whatsapp",
    "/api/admin/inbox",
    "/api/wa",            // bridge webhooks (inbound / receipt / tick / device)
  ],
  adminReviews: ["/api/admin/reviews", "/api/admin/review-requests"],
  adminCampaignLinks: ["/api/admin/links"],
  adminTwoFactor: [],     // /api/admin/login/2fa + /api/admin/security nijei guard kore
  googleLogin: ["/api/auth/google"], // callback sub-path o dhora porbe
  freeDelivery: [],
  soldCount: [],
  colorGroups: ["/api/admin/color-groups"],
  cardImageSwipe: [],
};

const matches = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/** Kon flagged feature ei path ta dhakche (jodi kono ta dhake). null = path ta visible. */
export function hiddenFeatureForPath(pathname: string): FeatureKey | null {
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    if (FEATURES[key]) continue; // switch ON → feature visible
    const all = [...HIDDEN_ADMIN_PAGES[key], ...HIDDEN_ADMIN_APIS[key]];
    if (all.some((base) => matches(pathname, base))) return key;
  }
  return null;
}

/** Sidebar-jonno: ei href ta ki hidden page-er? */
export function isHiddenAdminHref(href: string): boolean {
  return hiddenFeatureForPath(href) !== null;
}
