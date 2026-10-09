/**
 * MONEY — the single authoritative implementation of currency arithmetic.
 *
 * Every amount in this codebase is an integer number of *minor units*
 * (poisha for BDT). Floats are never used for money: no 0.1 + 0.2, no
 * rounding drift, no accidental `1.005 * 100` truncation.
 *
 * A `Money` value is therefore just a branded integer with helpers.
 */

const CURRENCY_DEFAULT = 'BDT';

/** BDT/Bangladeshi numerals are grouped in lakh/crore style by convention, but
 * the storefront prices are small enough that 1,234.00 grouping is expected. */
const CURRENCY_CONFIG: Record<string, { symbol: string; locale: string; decimals: number }> = {
  BDT: { symbol: '৳', locale: 'en-IN', decimals: 2 },
  USD: { symbol: '$', locale: 'en-US', decimals: 2 },
  EUR: { symbol: '€', locale: 'de-DE', decimals: 2 },
  GBP: { symbol: '£', locale: 'en-GB', decimals: 2 },
};

export function currencyConfig(currency: string) {
  return CURRENCY_CONFIG[currency.toUpperCase()] ?? { symbol: '', locale: 'en-US', decimals: 2 };
}

/** Parses admin/user input ("1,299.50", "1299.50", 1299) into minor units. */
export function toMinor(input: string | number, currency = CURRENCY_DEFAULT): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Invalid amount: ${input}`);
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid amount: ${input}`);
  void currency;
  return Math.round(parsed * 100);
}

/**
 * Lenient, null-safe unit conversion for DB rows and engine payloads
 * (null / undefined → 0). Kept here, in the money module, so the pure
 * promotion service can use it WITHOUT pulling in the Prisma repository.
 */
export function toMinorSafe(value: number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

/** Minor units -> decimal number (display, exports, structured data). */
export function toMajor(minor: number): number {
  assertMinor(minor);
  return minor / 100;
}

function assertMinor(minor: number): void {
  if (!Number.isInteger(minor)) {
    throw new Error(`Money must be an integer in minor units, received ${minor}`);
  }
}

/** Sums minor amounts safely. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertMinor(amount);
    total += amount;
  }
  return total;
}

export function addMinor(...amounts: number[]): number {
  return sumMinor(amounts);
}

export function subMinor(a: number, b: number): number {
  assertMinor(a);
  assertMinor(b);
  return a - b;
}

export function mulMinor(amount: number, quantity: number): number {
  assertMinor(amount);
  if (!Number.isInteger(quantity)) throw new Error(`Quantity must be an integer: ${quantity}`);
  return amount * quantity;
}

/**
 * Percentage of an amount, rounded half-up to the nearest minor unit.
 * Basis points (integer) are used instead of floats so 12.5% is exact.
 */
export function percentOfMinor(amount: number, percent: number): number {
  assertMinor(amount);
  const basisPoints = Math.round(percent * 100);
  return Math.round((amount * basisPoints) / 10_000);
}

/** Clamps an amount into [min, max]. */
export function clampMinor(amount: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  assertMinor(amount);
  return Math.min(Math.max(amount, min), max);
}

/** Formats minor units for display: `৳1,299.00`, `৳1,299` when whole+tidy. */
export function formatMoney(
  minor: number,
  opts: { currency?: string; showDecimals?: boolean | 'auto'; free?: string } = {},
): string {
  const currency = (opts.currency ?? CURRENCY_DEFAULT).toUpperCase();
  const config = currencyConfig(currency);
  if (opts.free !== undefined && minor === 0) return opts.free;

  const decimals = opts.showDecimals === false ? 0 : config.decimals;
  const value = minor / 100;
  const formatted = new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${config.symbol}${formatted}`;
}

/** Discount percentage between compare-at and selling price (0 when no sale). */
export function discountPercent(priceMinor: number, compareAtMinor?: number | null): number {
  if (!compareAtMinor || compareAtMinor <= priceMinor) return 0;
  return Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100);
}

export const MONEY_CURRENCY = CURRENCY_DEFAULT;
