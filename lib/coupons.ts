import type { Coupon, Prisma } from "@prisma/client";
import { couponDiscount } from "./checkout-pricing";
import { FEATURES } from "./features";

export class CouponValidationError extends Error {}

/* Shared eligibility rules: the preview endpoint and checkout must agree. */
export async function validateCoupon(
  tx: Pick<Prisma.TransactionClient, "order">,
  coupon: Coupon | null,
  subtotal: number,
  phone?: string,
) {
  /* Every "this code exists but is not usable" branch used to carry its own message —
     "Coupon not active yet", "Coupon expired", "Coupon usage limit reached", "Invalid
     coupon type". Together they are an oracle: POST /api/coupon with a guessed code and
     the wording says whether the code is real, whether its window passed and whether its
     quota is spent — without ever redeeming it. Shop codes are short, human and seasonal
     (EID50, NEWYEAR10), so guessing is cheap and the whole table can be mapped by script.

     One message for every unusable code. The cases that only fire for a code that IS live
     and that this shopper is legitimately trying to use (minimum order, already redeemed
     on this phone) keep their specific wording — those are not discovery signals. */
  const UNUSABLE = "Invalid coupon code";
  if (!coupon?.active) throw new CouponValidationError(UNUSABLE);
  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw new CouponValidationError(UNUSABLE);
  if (coupon.endsAt && now > coupon.endsAt) throw new CouponValidationError(UNUSABLE);
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new CouponValidationError(UNUSABLE);
  if (!["percent", "fixed", "freeship"].includes(coupon.type)) throw new CouponValidationError(UNUSABLE);
  if (coupon.minOrder != null && subtotal < coupon.minOrder) throw new CouponValidationError(`Minimum order ৳${coupon.minOrder} required`);
  /* Free delivery off (lib/features.ts) — freeship coupon gulo ar kaj kore na.
     Same generic wording as the other unusable branches: a distinct message here would
     confirm that a guessed code exists and happens to be a freeship one. */
  if (!FEATURES.freeDelivery && coupon.type === "freeship") throw new CouponValidationError(UNUSABLE);
  if (phone && coupon.firstOrderOnly) {
    const prior = await tx.order.count({ where: { phone, status: { notIn: ["CANCELLED"] } } });
    if (prior) throw new CouponValidationError("Coupon valid on first order only");
  }
  if (phone && coupon.perCustomer != null) {
    const used = await tx.order.count({ where: { phone, couponCode: coupon.code, status: { notIn: ["CANCELLED"] } } });
    if (used >= coupon.perCustomer) throw new CouponValidationError("You have already used this coupon");
  }
  return { code: coupon.code, type: coupon.type, value: coupon.value, maxDiscount: coupon.maxDiscount, discount: couponDiscount(subtotal, coupon), freeship: FEATURES.freeDelivery && coupon.type === "freeship" };
}
