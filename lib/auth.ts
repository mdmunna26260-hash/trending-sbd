import crypto from "crypto";
import { db } from "./db";

import { ALLOW_URL_TOKEN, SESSION_SECRET, encodeSessionPayload, decodeSessionPayload, cookieToken } from "./session-token";
import { FEATURES } from "./features";

const IS_PROD = process.env.NODE_ENV === "production";

export type SessionUser = { id: number; email: string; name: string; role: string; exp: number; sv?: number };

export const ROLE_PERMS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: ["products", "orders", "customers", "coupons", "reviews", "marketing", "tracking", "settings", "users", "audit", "categories", "collections", "promotions"],
  ORDER_MANAGER: ["orders", "customers"],
  PRODUCT_MANAGER: ["products", "categories", "collections", "inventory"],
  MARKETING: ["coupons", "marketing", "tracking", "promotions"],
  SUPPORT: ["orders", "customers", "reviews"],
};
export function can(user: SessionUser | null, perm: string): boolean {
  if (!user) return false;
  const perms = ROLE_PERMS[user.role] || [];
  return perms.includes("*") || perms.includes(perm);
}

export function createToken(u: Omit<SessionUser, "exp">): string {
  return encodeSessionPayload({ ...u, kind: "admin", exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
}
export function verifyToken(token?: string | null): SessionUser | null {
  const user = decodeSessionPayload(token);
  if (!user || (user.kind !== undefined && user.kind !== "admin") || user.p !== undefined) return null;
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.email !== "string" || typeof user.name !== "string") return null;
  if (typeof user.role !== "string" || !Object.prototype.hasOwnProperty.call(ROLE_PERMS, user.role)) return null;
  if (user.sv !== undefined && (!Number.isSafeInteger(user.sv) || user.sv < 0)) return null;
  return user as SessionUser;
}

/* Always re-read the account, including for legacy tokens and URL/Bearer
   fallbacks. A disabled/deleted/downgraded user must not keep the role embedded
   in a seven-day-old token. Legacy tokens belong to session version zero. */
export async function verifySessionToken(token?: string | null): Promise<SessionUser | null> {
  const user = verifyToken(token);
  if (!user) return null;
  const current = await db.user.findUnique({
    where: { id: user.id },
    select: { email: true, name: true, role: true, sessionVersion: true, active: true },
  }).catch(() => null);
  if (!current?.active || current.sessionVersion !== (user.sv ?? 0)) return null;
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMS, current.role)) return null;
  return { ...user, email: current.email, name: current.name, role: current.role, sv: current.sessionVersion };
}
export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  if (req) return verifySessionToken(cookieToken(req, ["sz_session", "sz_session_fb"]));
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const c = jar.get("sz_session") || jar.get("sz_session_fb");
  return verifySessionToken(c?.value);
}

/* ---- second step of admin login (TOTP) ---------------------------------------
   The password step hands back a short-lived, HMAC-signed ticket instead of a session;
   nothing is logged in until the 6-digit code checks out. Same secret as the session,
   so a forged ticket cannot outlive its window or name a different account. */
export function sessionTicket(userId: number, sv: number, minutes = 5): string {
  return encodeSessionPayload({ id: userId, sv, p: "2fa", nonce: crypto.randomBytes(12).toString("hex"), exp: Date.now() + minutes * 60_000 });
}
export function verifySessionTicket(ticket?: string | null): { id: number; sv: number } | null {
  const p = decodeSessionPayload(ticket);
  if (!p || p.p !== "2fa" || !Number.isSafeInteger(p.id) || p.id <= 0 || !Number.isSafeInteger(p.sv) || p.sv < 0) return null;
  return { id: p.id, sv: p.sv };
}
export function sessionCookie(token: string) {
  return { name: "sz_session", value: token, httpOnly: true, sameSite: "lax" as const, secure: IS_PROD, path: "/", maxAge: 60 * 60 * 24 * 7 };
}
export async function logAudit(email: string, action: string, detail?: string, ip?: string) {
  try { await db.auditLog.create({ data: { userEmail: email, action, detail: detail ? detail.slice(0, 2000) : undefined, ip } }); } catch {}
}
// simple in-memory rate limiter
const buckets: Map<string, number[]> = (global as any).__rl || ((global as any).__rl = new Map());
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}

// ---- URL-token fallback (for browsers/previews that block cookies) ----
export function adminLanding(user: SessionUser): string {
  if (can(user, "orders")) return "/admin/dashboard";
  if (can(user, "products")) return "/admin/products";
  /* Engagement hidden thakle /admin/marketing-o hidden — MARKETING role er user ke tar porer
     allowed page e pathai, noile login → hidden page → ferot login loop hoto. */
  if (FEATURES.adminAbandonedCart && can(user, "marketing")) return "/admin/marketing";
  if (can(user, "coupons")) return "/admin/coupons";
  return "/admin/login";
}

export async function requireAdmin(sp?: { t?: string | string[] | undefined }, perm?: string | string[]): Promise<SessionUser> {
  let user = await getSessionUser();
  const t = Array.isArray(sp?.t) ? sp.t[0] : sp?.t;
  if (!user && ALLOW_URL_TOKEN) user = await verifySessionToken(t);
  const { redirect } = await import("next/navigation");
  if (!user) redirect("/admin/login");
  if (perm && !(Array.isArray(perm) ? perm : [perm]).some((p) => can(user, p))) {
    const query = new URLSearchParams({ denied: "1" });
    if (ALLOW_URL_TOKEN && t) query.set("t", t);
    redirect(adminLanding(user) + "?" + query);
  }
  return user;
}
export function tokenFromRequest(req?: Request): string | null {
  if (!req) return null;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  if (!ALLOW_URL_TOKEN) return null; // never read the token from the query string in production
  return new URL(req.url).searchParams.get("t");
}

/* ---- Signed one-click unsubscribe (marketing emails) ----
   The link in a campaign email carries an HMAC of the address, signed with the same app secret
   as session tokens. Without it any visitor could unsubscribe any address by guessing it. */
export function unsubscribeToken(email: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(email || "").trim().toLowerCase()).digest("hex").slice(0, 32);
}
export function verifyUnsubscribe(email: string, k?: string | null): boolean {
  const want = unsubscribeToken(email);
  const got = String(k || "");
  if (got.length !== want.length) return false;
  const enc = new TextEncoder();
  try { return crypto.timingSafeEqual(enc.encode(got), enc.encode(want)); } catch { return false; }
}
