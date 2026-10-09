import { unstable_cache, revalidateTag } from "next/cache";
import { db } from "./db";
import { FEATURES } from "./features";
export type SettingsMap = Record<string, any>;
let cache: { data: SettingsMap; at: number } | null = null;
const TTL = 3000;

/* Persistent per-lambda data cache: settings are read from Postgres at most
   once every 30s per instance (instead of on every dynamic page render).
   Admin saves call revalidateTag("settings") → instant refresh. */
const readSettings = unstable_cache(
  async () => {
    const rows = await db.setting.findMany({ where: { NOT: { key: { startsWith: "security." } } } });
    const out: SettingsMap = {};
    for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
    return out;
  },
  ["settings-v1"],
  { revalidate: 30, tags: ["settings"] }
);

export async function getSettings(force = false): Promise<SettingsMap> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  const out: SettingsMap = force ? await (async () => {
    const rows = await db.setting.findMany({ where: { NOT: { key: { startsWith: "security." } } } });
    const o: SettingsMap = {};
    for (const r of rows) { try { o[r.key] = JSON.parse(r.value); } catch { o[r.key] = r.value; } }
    return o;
  })() : await readSettings();
  cache = { data: out, at: Date.now() };
  return out;
}
export function publicSettings(s: SettingsMap) {
  const checkout = { ...(s.checkout || {}) };
  delete checkout.giftWrapFee;
  return {
    store: s.store, theme: s.theme, shipping: {
      insideDhaka: s.shipping?.insideDhaka, outsideDhaka: s.shipping?.outsideDhaka,
      freeShippingThreshold: s.shipping?.freeShippingThreshold,
      estimateInside: s.shipping?.estimateInside, estimateOutside: s.shipping?.estimateOutside,
    },
    homepage: s.homepage, checkout, seo: s.seo,
    integrations: {
      metaPixelId: s.integrations?.metaPixelId || process.env.META_PIXEL_ID || "",
      ga4Id: s.integrations?.ga4Id || process.env.GA4_MEASUREMENT_ID || "",
      gtmId: s.integrations?.gtmId || process.env.GTM_ID || "",
      // Google (Gmail) login — public id only, the secret never leaves the server
      googleLoginClientId: s.integrations?.googleClientId || process.env.GOOGLE_CLIENT_ID || "",
      /* googleLogin switch off (lib/features.ts) → client config-e o false jay, tai button kono
         surface e render hobe na (login page + jekono future caller). */
      googleLoginEnabled: FEATURES.googleLogin && !!(s.integrations?.googleClientId || process.env.GOOGLE_CLIENT_ID),
    },
    maintenance: s.maintenance,
  };
}
export async function saveGroup(key: string, value: any) {
  await db.setting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } });
  cache = null;
  revalidateTag("settings"); // persistent cache instances refresh instantly
}
export function envFallback(s: SettingsMap): SettingsMap {
  const out = JSON.parse(JSON.stringify(s));
  out.courier = out.courier || {};
  out.courier.apiUrl = out.courier.apiUrl || process.env.STEADFAST_API_URL || "";
  out.courier.apiKey = out.courier.apiKey || process.env.STEADFAST_API_KEY || "";
  out.courier.secretKey = out.courier.secretKey || process.env.STEADFAST_SECRET_KEY || "";
  out.integrations = out.integrations || {};
  out.integrations.metaAccessToken = out.integrations.metaAccessToken || process.env.META_ACCESS_TOKEN || "";
  out.integrations.metaPixelId = out.integrations.metaPixelId || process.env.META_PIXEL_ID || "";
  out.integrations.metaTestEventCode = out.integrations.metaTestEventCode || process.env.META_TEST_EVENT_CODE || "";
  return out;
}
