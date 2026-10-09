"use server";
import { getSettings, envFallback } from "@/lib/settings";
import { storeUrl } from "@/lib/notify";

/** Shared SMTP transport factory used by password-reset, order emails, abandoned-cart, etc.
 *  Returns null if SMTP hasn't been configured in Settings → Notifications. */
export async function adminTransport() {
  const s = envFallback(await getSettings());
  const n: any = s.notifications || {};
  if (!n.smtp?.host || !n.smtp?.user || !n.smtp?.pass) return null;
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({
    host: n.smtp.host,
    port: Number(n.smtp.port) || 587,
    secure: Number(n.smtp.port) === 465,
    auth: { user: n.smtp.user, pass: n.smtp.pass },
  });
}

export async function mailFrom() {
  const s = envFallback(await getSettings());
  const brand = s.store?.name || "TRENDING'S";
  const fromAddr = (s.notifications as any)?.smtp?.user || "no-reply@sinzo.dev";
  return { brand, fromAddr, url: storeUrl(s) };
}

/** Send the admin password-reset email. Returns { ok, devPreviewUrl?, error? }.
 *  In local dev where SMTP is unconfigured we still return devPreviewUrl so the
 *  admin can complete the flow without spinning up a mail server. */
export async function sendAdminResetEmail(to: string, token: string): Promise<{ ok: boolean; devPreviewUrl?: string; error?: string; transport?: boolean }> {
  const { brand, fromAddr, url } = await mailFrom();
  const resetUrl = `${url.replace(/\/$/, "")}/admin/reset?token=${encodeURIComponent(token)}`;
  const subject = `[${brand}] Reset your admin password`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;padding:40px 36px;box-shadow:0 1px 3px rgba(16,24,40,.08);">
      <div style="font-size:13px;letter-spacing:.24em;color:#98a2b3;font-weight:600;">${brand.toUpperCase()} · ADMIN</div>
      <h1 style="margin:14px 0 8px;font-size:24px;color:#101828;font-weight:650;">Reset your password</h1>
      <p style="color:#475467;font-size:14.5px;line-height:1.6;margin:10px 0 22px;">We received a request to reset the admin password for <b style="color:#101828;">${to}</b>. Click the button below to set a new password. This link expires in 30 minutes.</p>
      <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">Reset password</a>
      <p style="color:#98a2b3;font-size:12.5px;line-height:1.5;margin:24px 0 6px;">If the button doesn't work, copy this link into your browser:</p>
      <p style="word-break:break-all;color:#475467;font-size:12px;margin:0;">${resetUrl}</p>
      <p style="color:#98a2b3;font-size:12px;margin-top:24px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    </div></body></html>`;
  const text = `Reset your ${brand} admin password\n\nReset link (expires in 30 minutes):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;

  const transport = await adminTransport();
  if (!transport) {
    // SMTP not configured — surface a dev preview link so the flow is still usable.
    return { ok: true, devPreviewUrl: resetUrl, transport: false };
  }
  try {
    await transport.sendMail({
      from: `${brand} <${fromAddr}>`,
      replyTo: fromAddr,
      to,
      subject,
      html,
      text,
    });
    return { ok: true, transport: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Mail send failed" };
  }
}
