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
  if (!coupon?.active) throw new CouponValidationError("Invalid coupon code");
  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw new CouponValidationError("Coupon not active yet");
  if (coupon.endsAt && now > coupon.endsAt) throw new CouponValidationError("Coupon expired");
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new CouponValidationError("Coupon usage limit reached");
  if (coupon.minOrder != null && subtotal < coupon.minOrder) throw new CouponValidationError(`Minimum order ৳${coupon.minOrder} required`);
  if (!["percent", "fixed", "freeship"].includes(coupon.type)) throw new CouponValidationError("Invalid coupon type");
  /* Free delivery off (lib/features.ts) — freeship coupon gulo ar kaj kore na. */
  if (!FEATURES.freeDelivery && coupon.type === "freeship") throw new CouponValidationError("This coupon is not available");
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
