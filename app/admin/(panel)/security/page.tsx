import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import SecurityClient from "./client";
import { FEATURES } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

/* Security screen: two-factor + "log out everywhere".
   The admin panel is the keys to the shop; a password alone is thin protection, so TOTP
   (Google Authenticator / Authy / 1Password) can be switched on here, with one-time recovery
   codes for the day the phone is lost. */
export default async function SecurityPage(props: { searchParams: Promise<{ t?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "settings");
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const u = await db.user.findUnique({ where: { id: user.id } });
  const codes = (u?.recoveryCodes || "").split("\n").filter(Boolean).length;
  const logins = await db.auditLog.findMany({
    where: {
      OR: [
        { userEmail: u?.email || "", action: { in: ["LOGIN", "LOGIN_2FA", "LOGIN_2FA_RECOVERY", "LOGIN_FAILED", "LOGIN_2FA_FAILED", "LOGOUT_ALL", "2FA_ENABLED", "2FA_DISABLED"] } },
        { action: { in: ["LOGIN_FAILED", "LOGIN_2FA_FAILED"] } },
      ],
    },
    orderBy: { id: "desc" }, take: 15,
  });
  const admins = await db.user.count({ where: { active: true } });

  return (
    <>
      <div className="admin-top">
        <div><h1>Security</h1><div className="who">{u?.email} · {u?.role} · {admins} active admin{admins === 1 ? "" : "s"}</div></div>
      </div>
      <SecurityClient
        initial={{ enabled: !!u?.twoFactorEnabled, recoveryCodesLeft: codes, sessionVersion: u?.sessionVersion || 0 }}
        logins={logins.map((l) => ({ action: l.action, at: l.createdAt.toISOString(), ip: l.ip || "", email: l.userEmail }))}
      />
      {/* 2FA hidden hole TOTP explainer-o lagbe na */}
      {FEATURES.adminTwoFactor && (
  <div className="cfg-note" style={{ marginTop: 16 }}>
          Two-factor uses standard TOTP (SHA-1 / 6 digits / 30 s), so any authenticator app works — no
          extra service and no SMS fee. Recovery codes are stored hashed and burn one at a time.
          &ldquo;Log out everywhere&rdquo; bumps a per-user session version: every token issued earlier stops working
          immediately, while this browser gets a fresh one.
        </div>
      )}

    </>
  );
}
