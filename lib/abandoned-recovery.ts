import crypto from "node:crypto";
import { db } from "./db";
import { getSettings } from "./settings";
import { storeUrl } from "./notify";
import { prepareRecoveredCart, validateRecoveryContact, readSavedCart, lockAbandoned, escapeEmail } from "./abandoned-cart";
import { RECOVERY_DELAY, RECOVERY_COOLDOWN, recipientKeys, signRecoveryToken, recoveryUrl } from "./recovery-security";
import { ensureExtraTables } from "./db-ensure";

type Result = { sent: number; skipped: number; failed: number; disabled?: boolean };
/* One durable automatic attempt per draft, plus a 24h email/phone cooldown.
   SMTP cannot offer transactional exactly-once delivery: ambiguous failures are
   NOT auto-retried. Staff must check provider logs before explicitly retrying. */
async function claim(id: number, cutoff: Date) {
  return db.$transaction(async tx => {
    await lockAbandoned(tx, id);
    const row = await tx.abandonedCheckout.findUnique({ where: { id } });
    if (!row || row.checkoutStatus !== "OPEN" || row.updatedAt > cutoff || row.recoveryAttemptedAt || row.recoveryEmailedAt || !row.email || !row.captureKeyHash) return null;
    const now = new Date(), claimId = crypto.randomUUID();
    await tx.abandonedCheckout.update({ where: { id }, data: { recoveryAttemptedAt: now, recoveryClaimId: claimId, recoveryError: null } });
    try { validateRecoveryContact(row); readSavedCart(row.cartJson); } catch {
      await tx.abandonedCheckout.update({ where: { id }, data: { recoveryClaimId: null, recoveryError: "Invalid/legacy saved cart; ask the customer to rebuild checkout." } });
      return { skipped: true as const };
    }
    const keys = recipientKeys(row.phone!, row.email);
    const states: { key: string; value: string }[] = [];
    const param = (process.env.DATABASE_URL || "").startsWith("postgres") ? "$1" : "?";
    // Sorted row locks prevent two workers from contacting the same recipient
    // through different private capture keys at once.
    for (const key of keys) {
      await tx.setting.upsert({ where: { key }, create: { key, value: "{}" }, update: {} });
      await tx.$executeRawUnsafe(`UPDATE "Setting" SET "value" = "value" WHERE "key" = ${param}`, key);
      states.push(await tx.setting.findUniqueOrThrow({ where: { key } }));
    }
    for (const state of states) {
      let previous: any = {}; try { previous = JSON.parse(state.value); } catch {}
      if (typeof previous.at === "number" && now.getTime() - previous.at < RECOVERY_COOLDOWN) {
        await tx.abandonedCheckout.update({ where: { id }, data: { recoveryClaimId: null, recoveryError: "A reminder was already attempted for this recipient in the last 24 hours." } });
        return { skipped: true as const };
      }
    }
    for (const key of keys) await tx.setting.update({ where: { key }, data: { value: JSON.stringify({ at: now.getTime(), id, claimId }) } });
    return { row, claimId, skipped: false as const };
  }, { maxWait: 10_000, timeout: 15_000 });
}

// Only release a claim when SMTP was definitely never invoked. A shopper who
// resumed typing should become eligible again after the inactivity delay.
async function releaseUnsentClaim(row: any, claimId: string) {
  await db.$transaction(async tx => {
    await lockAbandoned(tx, row.id);
    const current = await tx.abandonedCheckout.findUnique({ where: { id: row.id } });
    if (!current || current.recoveryClaimId !== claimId) return;
    for (const key of recipientKeys(row.phone, row.email)) {
      const old = await tx.setting.findUnique({ where: { key } });
      let state: any = {}; try { state = JSON.parse(old?.value || "{}"); } catch {}
      if (state.id === row.id && state.claimId === claimId) await tx.setting.updateMany({ where: { key, value: old!.value }, data: { value: "{}" } });
    }
    await tx.abandonedCheckout.update({ where: { id: row.id }, data: { recoveryAttemptedAt: null, recoveryClaimId: null, recoveryError: null } });
  });
}

export async function sendAbandonedRecoveryEmails(options: { automatic?: boolean } = {}): Promise<Result> {
  await ensureExtraTables();
  const s = await getSettings(true);
  const result: Result = { sent: 0, skipped: 0, failed: 0 };
  if (options.automatic && s.marketing?.recoveryAutoEnabled !== true) return { ...result, disabled: true };
  const cfg = s.notifications?.smtp;
  if (!cfg?.host || !cfg?.user || !cfg?.pass) throw new Error("SMTP not configured (Settings → Notifications)");
  const cutoff = new Date(Date.now() - RECOVERY_DELAY);
  const rows = await db.abandonedCheckout.findMany({ where: {
    checkoutStatus: "OPEN", email: { not: null }, phone: { not: null }, name: { not: null },
    captureKeyHash: { not: null }, updatedAt: { lte: cutoff }, recoveryAttemptedAt: null, recoveryEmailedAt: null,
  }, select: { id: true }, orderBy: { updatedAt: "desc" }, take: 5 });
  const nodemailer = await import("nodemailer");
  const port = Number(cfg.port) || 587;
  const transport = nodemailer.createTransport({ host: cfg.host, port, secure: port === 465 || cfg.secure === true,
    auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  const brand = String(s.store?.name || "TRENDING'S");
  const coupon = typeof s.marketing?.recoveryCoupon === "string" ? s.marketing.recoveryCoupon.trim().toUpperCase() : null;
  try {
    for (const item of rows) {
      let claimed: Awaited<ReturnType<typeof claim>>;
      try { claimed = await claim(item.id, cutoff); } catch { result.failed++; continue; }
      if (!claimed || claimed.skipped) { result.skipped++; continue; }
      const { row, claimId } = claimed;
      try {
        const preview = await prepareRecoveredCart(db, row, s, coupon);
        if (!preview.lines.length) {
          await db.abandonedCheckout.updateMany({ where: { id: row.id, recoveryClaimId: claimId }, data: { recoveryClaimId: null, recoveryError: "Saved items are no longer available. No reminder sent." } });
          result.skipped++; continue;
        }
        // Recheck after quoting and before SMTP; a converted or actively edited
        // checkout is never deliberately contacted from an old query snapshot.
        const current = await db.abandonedCheckout.findUnique({ where: { id: row.id } });
        if (!current || current.checkoutStatus !== "OPEN" || current.recoveryClaimId !== claimId || current.email !== row.email || current.phone !== row.phone || current.updatedAt > cutoff) {
          await releaseUnsentClaim(row, claimId);
          result.skipped++; continue;
        }
        const appliedCode = preview.applied?.code || null;
        const link = recoveryUrl(storeUrl(s), signRecoveryToken(current, appliedCode));
        const e = escapeEmail;
        const items = preview.lines.map(l => `<tr><td style="padding:6px 0">${e(l.title)} ${e([l.size, l.color].filter(Boolean).join(" · "))} × ${l.qty}</td><td style="text-align:right">৳${(l.price * l.qty).toLocaleString("en-IN")}</td></tr>`).join("");
        const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#141414">
          <h2>${e(brand)}</h2><h3>${e(row.name)}, apnar cart ta waiting!</h3>
          <p>Checkout complete hoy nai. Apnar saved cart abar open kore current price, stock ebong delivery details review korun.</p>
          <table style="width:100%">${items}</table><p><b>Current total: ৳${preview.totals.total.toLocaleString("en-IN")}</b> (Cash on Delivery)</p>
          ${appliedCode ? `<p>Recovery coupon: <b>${e(appliedCode)}</b> — eligible hole checkout e automatic apply hobe.</p>` : ""}
          <p><a href="${e(link)}" style="display:inline-block;background:#141414;color:white;padding:13px 26px;text-decoration:none">Restore cart &amp; complete order</a></p>
          <p style="font-size:11px;color:#777">Private link · expires in 7 days. Prices and stock are rechecked at checkout. You received one reminder because you started checkout; no further automatic reminder for this draft.</p></div>`;
        const sent = await transport.sendMail({ from: { name: brand, address: cfg.from || cfg.user }, replyTo: cfg.user, to: row.email!,
          subject: `${row.name}, apnar cart toh baki ase!`, html,
          text: `${row.name}, apnar saved cart restore korun: ${link}\nCurrent total: ৳${preview.totals.total}${appliedCode ? "\nCoupon: " + appliedCode : ""}\nPrivate link expires in 7 days.`,
          headers: { "Auto-Submitted": "auto-generated", "X-Entity-Ref-ID": claimId },
        });
        if (!sent.accepted?.length) throw new Error("SMTP rejected recipient");
        await db.abandonedCheckout.updateMany({ where: { id: row.id, recoveryClaimId: claimId }, data: { recoveryEmailedAt: new Date(), recoveryClaimId: null, recoveryError: null } });
        result.sent++;
      } catch {
        // Do not log SMTP credentials/server responses or retry ambiguous delivery.
        await db.abandonedCheckout.updateMany({ where: { id: row.id, recoveryClaimId: claimId }, data: { recoveryClaimId: null, recoveryError: "Send failed or delivery is uncertain. Check SMTP/provider logs before explicitly retrying." } }).catch(() => {});
        result.failed++;
      }
    }
  } finally { transport.close(); }
  return result;
}
