import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import { assessRisk } from "@/lib/risk";
import { sendCapi } from "@/lib/capi";
import { detectSource, getClientIp } from "@/lib/ua";
import { rateLimit } from "@/lib/auth";
import { orderCode } from "@/lib/slug";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
import { notifyAdmin, emailCustomerOrder } from "@/lib/notify";
import { subscribeImplicit } from "@/lib/newsletter";
import { parseCheckoutLines, buildCheckoutItems, CheckoutValidationError } from "@/lib/checkout-items";
import { loadActivePromotion } from "@/lib/promotions/repository";
import { evaluateCart } from "@/lib/promotions/service";
import { slotSelectionKey } from "@/lib/promotions/engine";
import type { GiftSelectionMap } from "@/lib/promotions/types";
import { checkoutTotals } from "@/lib/checkout-pricing";
import { validateCoupon, CouponValidationError } from "@/lib/coupons";
import { deployChannel } from "@/lib/deploy-channel";
import { captureKeyHash } from "@/lib/recovery-security";
import { verifyRecovery, lockAbandoned, RecoveryError } from "@/lib/abandoned-cart";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid checkout request" }, { status: 400 });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
    const { area, couponCode } = body;
    const paymentMethod = body.paymentMethod || "COD";
    const purchaseEventId = typeof body.purchaseEventId === "string" ? body.purchaseEventId.slice(0, 128) : undefined;
    const cleanPhone = normalizeBDPhone(String(body.phone || ""));
    const errors: Record<string, string> = {};
    if (name.length < 3 || name.length > 80) errors.name = "Please enter your full name (3–80 characters)";
    if (!isValidBDPhone(cleanPhone)) errors.phone = "Enter a valid BD mobile number";
    if (address.length < 10 || address.length > 1000) errors.address = "Please enter your full address (10–1000 characters)";
    if (body.email && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = "Please enter a valid email address";
    if (area !== "INSIDE_DHAKA" && area !== "OUTSIDE_DHAKA") errors.area = "Select delivery zone";
    if (Object.keys(errors).length) return NextResponse.json({ error: "Please fix the highlighted fields", errors }, { status: 400 });
    const lines = parseCheckoutLines(body.items);
    const captureHash = body.captureKey == null ? null : captureKeyHash(body.captureKey);
    if (body.captureKey != null && !captureHash) throw new RecoveryError("Invalid checkout session");

    const ip = getClientIp(req);
    if (!rateLimit("checkout:" + ip, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Please try again in a few minutes." }, { status: 429 });
    }
    const { ensureExtraTables } = await import("@/lib/db-ensure");
    await ensureExtraTables();
    const s = envFallback(await getSettings(true));
    const shipCfg = s.shipping || {};
    const checkoutCfg = s.checkout || {};
    if (paymentMethod !== "COD") return NextResponse.json({ error: "Online payment is not available yet. Please use Cash on Delivery." }, { status: 400 });
    if (checkoutCfg.codEnabled === false) return NextResponse.json({ error: "Cash on Delivery is currently disabled. Please contact support." }, { status: 400 });

    const products = await db.product.findMany({
      where: { id: { in: [...new Set(lines.map((i) => i.productId))] }, status: "ACTIVE" },
      include: { variants: true, images: { orderBy: { position: "asc" } } },
    });
    /* ------------------------------------------------------------------
       FREE-GIFT RE-VALIDATION (server-authoritative).
       The browser sends gift rows; none of them are trusted. We re-run the
       same pure engine against the PAID lines only, then keep a gift row only
       when the cart genuinely earned that slot. Surviving gift rows are priced
       at 0 by buildCheckoutItems — a tampered localStorage cart cannot buy
       anything and cannot mint a gift it did not earn.
       ------------------------------------------------------------------ */
    const promotion = await loadActivePromotion();
    let giftLines: typeof lines = [];
    let promotionMeta: { id: string; tierIndex: number; giftCount: number; giftValueMinor: number } | null = null;

    if (promotion) {
      const catByProduct = new Map(products.map((p) => [String(p.id), String((p as any).categoryId ?? "")]));
      const asCartLines = lines.map((l) => ({
        key: l.isGift ? `gift:${l.giftPromotionId}:${l.giftTierIndex}:${l.giftSlotKey}` : `${l.productId}:${l.variantId || 0}`,
        productId: l.productId, variantId: l.variantId, slug: "", title: "", price: 0,
        qty: l.qty, stock: 0, isGift: !!l.isGift, promotionId: l.giftPromotionId,
        tierIndex: l.giftTierIndex, slotKey: l.giftSlotKey,
      }));

      /* Rebuild the shopper's gift choices from the rows themselves — the exact
         slot→variant map the engine needs, without trusting a separate payload. */
      const selections: GiftSelectionMap = {};
      for (const l of lines) {
        if (!l.isGift || l.variantId == null || l.giftTierIndex == null || !l.giftSlotKey) continue;
        selections[slotSelectionKey(l.giftTierIndex, l.giftSlotKey)] = { productId: String(l.productId), variantId: String(l.variantId) };
      }

      const evaluation = evaluateCart({
        promotion, lines: asCartLines as any, selections,
        categories: Object.fromEntries(catByProduct),
      });

      const granted = new Set(
        evaluation.grantedGifts.map((g) => `${g.tierIndex}:${g.slotKey}:${g.productId}:${g.variantId}`),
      );

      for (const l of lines) {
        if (!l.isGift) continue;
        const key = `${l.giftTierIndex}:${l.giftSlotKey}:${l.productId}:${l.variantId}`;
        if (granted.has(key)) giftLines.push(l);
        else console.warn("[checkout] gift row dropped (not earned):", key);
      }

      const keptGifts = evaluation.grantedGifts.filter((g) =>
        giftLines.some((l) => String(l.productId) === g.productId && String(l.variantId) === g.variantId && l.giftTierIndex === g.tierIndex && l.giftSlotKey === g.slotKey),
      );
      if (keptGifts.length) {
        promotionMeta = {
          id: promotion.id,
          tierIndex: Math.max(...keptGifts.map((g) => g.tierIndex)),
          giftCount: keptGifts.length,
          giftValueMinor: keptGifts.reduce((sum, g) => sum + g.valueMinor, 0),
        };
      }
    } else {
      /* No live promotion → any gift row in the payload is stale. */
      for (const l of lines) if (l.isGift) console.warn("[checkout] gift row dropped (no live promotion)");
    }

    const paidLines = lines.filter((l) => !l.isGift);
    if (!paidLines.length) return NextResponse.json({ error: "Your cart has no payable items" }, { status: 400 });
    const { items: orderItems, subtotal } = buildCheckoutItems([...paidLines, ...giftLines], products);
    const risk = await assessRisk({ phone: cleanPhone, address, ip }, s.fraud);
    if (risk.level === "CRITICAL") return NextResponse.json({ error: "We're unable to accept this order. Please contact support." }, { status: 403 });

    // Only attribution strings are meaningful; an object in utm_source used to
    // throw in detectSource() and turn an otherwise valid order into a 500.
    const attribution: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "fbp", "fbc", "referrer"]) {
      if (typeof body.attribution?.[key] === "string") attribution[key] = body.attribution[key].slice(0, 2000);
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the buyer before draft/coupon mutations. Customer data changes
      // only after a new order is validated; retries cannot consume coupons twice.
      await tx.customer.upsert({ where: { phone: cleanPhone }, update: { phone: cleanPhone }, create: { phone: cleanPhone, name, address, area, email: email || null } });
      let draft = null;
      if (captureHash) {
        draft = await tx.abandonedCheckout.upsert({ where: { captureKeyHash: captureHash }, update: {}, create: {
          captureKeyHash: captureHash, name, phone: cleanPhone, email: email || null, address,
          total: subtotal, cartJson: JSON.stringify({ version: 2, items: orderItems, area, notes, couponCode: typeof couponCode === "string" ? couponCode : null }),
        } });
        await lockAbandoned(tx, draft.id);
        draft = await tx.abandonedCheckout.findUniqueOrThrow({ where: { id: draft.id } });
        if (draft.checkoutStatus !== "OPEN") {
          if (draft.phone !== cleanPhone || !draft.convertedOrderId) throw new RecoveryError("This checkout has already been handled", 409);
          const previous = await tx.order.findUnique({ where: { id: draft.convertedOrderId } });
          if (!previous) throw new RecoveryError("This checkout has already been handled", 409);
          return { order: previous, appliedCode: previous.couponCode, reused: true };
        }
      }
      const recovered = body.recoveryToken ? await verifyRecovery(tx, body.recoveryToken) : null;
      if (recovered) { await lockAbandoned(tx, recovered.row.id); await verifyRecovery(tx, body.recoveryToken); }
      let discount = 0;
      let freeship = false;
      let appliedCode: string | null = null;
      if (couponCode) {
        if (typeof couponCode !== "string") throw new CouponValidationError("Invalid coupon code");
        const code = couponCode.toUpperCase().trim();
        // A zero increment acquires the coupon's write lock, serializing both
        // usageLimit and per-customer/first-order checks across concurrent carts.
        const locked = await tx.coupon.updateMany({ where: { code, active: true }, data: { usedCount: { increment: 0 } } });
        if (!locked.count) throw new CouponValidationError("Invalid coupon code");
        const coupon = await tx.coupon.findUnique({ where: { code } });
        const applied = await validateCoupon(tx, coupon, subtotal, cleanPhone);
        discount = applied.discount;
        freeship = applied.freeship;
        appliedCode = applied.code;
        await tx.coupon.update({ where: { code }, data: { usedCount: { increment: 1 } } });
      }
      const { total, deliveryFee } = checkoutTotals({ subtotal, discount, area, shipping: shipCfg, freeship });
      const customer = await tx.customer.upsert({
        where: { phone: cleanPhone },
        update: { name, address, area, ...(email ? { email } : {}) },
        create: { phone: cleanPhone, name, address, area, email: email || null },
      });
      const order = await tx.order.create({
        data: {
          code: "TEMP-" + crypto.randomUUID(), name, phone: cleanPhone, email: email || null,
          address, area, notes: notes || null,
          subtotal, discount, deliveryFee, total, couponCode: appliedCode,
          paymentMethod, paymentStatus: "PENDING", status: risk.level === "HIGH" ? "ON_HOLD" : "PENDING",
          riskLevel: risk.level, riskFlags: risk.flags.join(", ") || null,
          source: recovered ? "Recovered" : detectSource(attribution), attribution: Object.keys(attribution).length ? JSON.stringify(attribution) : null,
          channel: deployChannel(), ip, customerId: customer.id, items: { create: orderItems as any },
        },
      });
      const finalOrder = await tx.order.update({ where: { id: order.id }, data: { code: orderCode(order.id) } });
      /* Promotion bookkeeping: one usage row per order + the running counter the
         engine reads for `maxOrders`. Kept inside the transaction so a failed
         order never counts against the offer. */
      if (promotionMeta) {
        await tx.promotionUsage.create({
          data: {
            promotionId: promotionMeta.id, orderId: finalOrder.id, tierIndex: promotionMeta.tierIndex,
            giftCount: promotionMeta.giftCount, giftValueMinor: promotionMeta.giftValueMinor,
          },
        });
        await tx.promotion.update({ where: { id: promotionMeta.id }, data: { usedOrders: { increment: 1 } } });
      }
      // Keep the store's delivery-time inventory policy: no stock decrement at checkout.
      await tx.abandonedCheckout.updateMany({ where: { OR: [{ phone: cleanPhone }, ...(draft ? [{ id: draft.id }] : []), ...(recovered ? [{ id: recovered.row.id }] : [])], checkoutStatus: "OPEN" }, data: { checkoutStatus: "CONVERTED", recovered: true, convertedOrderId: finalOrder.id } });
      return { order: finalOrder, appliedCode, reused: false };
    });
    const order = result.order;
    const code = order.code;
    const appliedCode = result.appliedCode;
    const total = order.total;
    if (result.reused) return NextResponse.json({ ok: true, code, total, risk: order.riskLevel, reused: true });

    // --- server-side Purchase via Meta CAPI (dedup with browser pixel by event_id) ---
    sendCapi({
      eventName: "Purchase",
      eventId: purchaseEventId || `srv_purchase_${order.id}`,
      eventSourceUrl: req.headers.get("referer") || undefined,
      userData: { phone: cleanPhone, email: email || undefined, name: String(name || ""), clientIp: ip, userAgent: req.headers.get("user-agent") || undefined, externalId: cleanPhone },
      customData: { currency: "BDT", value: total, content_type: "product", num_items: orderItems.reduce((a, i) => a + i.qty, 0), contents: orderItems.map((i) => ({ id: String(i.productId), quantity: i.qty, item_price: i.price })) },
    }).catch(() => {});

    // customer order-confirmation WhatsApp — written to the outbox here, sent by the worker
    // (lib/wa-queue → scripts/wa-worker.js, respecting caps/quiet hours/pacing). A blocked
    // number or a sleeping bridge can never slow this request down.
    await import("@/lib/wa-queue").then(({ enqueueOrderEvent }) => enqueueOrderEvent(order.id, "order_placed")).catch(() => {});

    // customer order-confirmation email (if email given + SMTP configured)
    if (email) {
      emailCustomerOrder(String(email), String(name).trim(), { code, total, area, items: orderItems.map((i) => ({ title: i.title + (i.preorder ? " [Pre-order]" : ""), qty: i.qty, price: i.price })) }).catch(() => {});
      /* Customer gave us a real email on checkout → silently add to newsletter
         list (only if never subscribed and never unsubscribed). Never overrides
         an existing unsubscribe, so it stays safe. */
      subscribeImplicit(String(email)).catch(() => {});
    }

    // admin notification (in-app + Telegram + email if configured)
    notifyAdmin("order.placed",
      `🛒 NEW ORDER ${code}`,
      `👤 ${name} (${cleanPhone})\n💰 ৳${Math.round(total).toLocaleString("en-IN")} · ${paymentMethod}\n📍 ${area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"}\n📦 ${orderItems.reduce((a, i) => a + i.qty, 0)} item(s)${appliedCode ? `\n🎟 ${appliedCode}` : ""}${risk.level !== "LOW" ? `\n⚠ Risk: ${risk.level}` : ""}`,
      code).catch(() => {});

    return NextResponse.json({ ok: true, code, total, risk: risk.level });
  } catch (e: any) {
    if (e instanceof CheckoutValidationError || e instanceof CouponValidationError) {
      return NextResponse.json({ error: e.message }, { status: e instanceof RecoveryError ? e.status : 400 });
    }
    console.error("checkout error", e);
    return NextResponse.json({ error: "Something went wrong placing your order. Please try again." }, { status: 500 });
  }
}
