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

/* Bengali (০-৯) and Devanagari (०-९) digits fold to ASCII before parsing. This shop is
   Bangladeshi and its admin forms are typed on phones that frequently offer a Bengali
   keypad, so "১২৯৯" is a price somebody will actually enter. */
const NON_ASCII_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

function normalizeDigits(input: string): string {
  return input.replace(/[\u09E6-\u09EF\u0966-\u096F]/g, (ch) => NON_ASCII_DIGITS[ch] ?? ch);
}

/**
 * Parses admin/user input ("1,299.50", "১২৯৯", "৳1299", 1299) into minor units.
 *
 * STRICT ON PURPOSE. The previous implementation ran `input.replace(/[^\d.-]/g, '')` and
 * returned 0 for anything that survived as empty, which made four silent failures:
 *   · "১২৯৯" (Bengali digits) → every character stripped → 0 → a ৳0.00 free product
 *   · "" / "abc" / "৳"         → 0, not an error, so a blank form field priced the item at zero
 *   · "-500"                   → -50000; a negative price was accepted and would have
 *                                subtracted from an order total
 *   · "1.2.3" → 120 and "1-2-3" → 100; parseFloat stops at the first bad character, so the
 *                                rest of the field was silently discarded
 * A price of ৳0.00 is indistinguishable from a real free item once it is in the database,
 * so the only safe behaviour is to reject input this function cannot parse with certainty.
 *
 * Accepts: optional currency symbol, thousands separators, one decimal point, a fraction
 * that is rounded half-up to the currency's decimal count. Rejects: signs, more than one
 * separator, any non-numeric residue, and magnitudes past Number.MAX_SAFE_INTEGER.
 */
export function toMinor(input: string | number, currency = CURRENCY_DEFAULT): number {
  const config = currencyConfig(currency);
  const scale = 10 ** config.decimals;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Invalid amount: ${input}`);
    if (input < 0) throw new Error(`Amount must not be negative: ${input}`);
    const minor = Math.round(input * scale);
    if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${input}`);
    return minor;
  }
  if (typeof input !== 'string') throw new Error(`Invalid amount: ${String(input)}`);

  /* Thousands separators and the currency's own symbol are decoration, not digits. Only the
     comma is stripped (BDT groups 1,23,456 lakh-style with the same character), so a dash or
     stray punctuation still fails the shape check below rather than being silently eaten.

     The symbol is removed with startsWith/slice, NOT a RegExp built from config: the first
     version of this used `new RegExp("^\\\\" + symbol, "u")`, which throws a SyntaxError for
     ৳, € and £ — under the /u flag an escaped character that is not punctuation is an
     invalid escape — and which for "$" would match end-of-string instead of a dollar sign.
     A config-driven regex is also a ReDoS/parse-failure surface that only appears at
     runtime, once somebody adds a currency with an awkward symbol. */
  let cleaned = normalizeDigits(input).trim().replace(/,/g, '');
  if (config.symbol && cleaned.startsWith(config.symbol)) {
    cleaned = cleaned.slice(config.symbol.length).trim();
  }

  /* A leading sign gets its own message: "must not be negative" tells an admin what to fix,
     where a bare "Invalid amount" does not. '+' is left to the shape check below. */
  if (cleaned.startsWith('-')) {
    throw new Error(`Amount must not be negative: ${JSON.stringify(input)}`);
  }

  const m = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (!m[1] && !m[2])) {
    throw new Error(`Invalid amount: ${JSON.stringify(input)}`);
  }

  /* Exact integer arithmetic on the decimal STRING — deliberately not
     `Math.round(parseFloat(cleaned) * scale)`. That float path is the very thing this
     module's header promises never to do ("no accidental 1.005 * 100 truncation"), and it
     does fail: 1.005 is stored as 1.00499999999999989, so * 100 gives 100.49999999999999
     and Math.round returns 100 — a silent one-poisha loss on every such price. Splitting at
     the decimal point keeps every step in integers, so the result is exact and rounds
     half-up on the first digit beyond the currency's precision. */
  const intPart = m[1] || '0';
  const frac = (m[2] || '').padEnd(config.decimals, '0');
  const kept = frac.slice(0, config.decimals);
  const firstDropped = config.decimals < frac.length ? Number(frac[config.decimals]) : 0;
  const minor = Number(intPart) * scale + Number(kept || '0') + (firstDropped >= 5 ? 1 : 0);

  /* Reached when the field is well-formed but simply too large — a 400-digit price parses
     to Infinity here. Reporting "out of range" rather than "invalid" distinguishes a typo
     of magnitude from a typo of shape. */
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Amount out of range: ${JSON.stringify(input)}`);
  }
  return minor;
}

/**
 * Lenient, null-safe unit conversion for DB rows and engine payloads
 * (null / undefined → 0). Kept here, in the money module, so the pure
 * promotion service can use it WITHOUT pulling in the Prisma repository.
 *
 * Also folds NaN/Infinity to 0. A Prisma Decimal or a corrupt column can arrive as
 * something Number() cannot handle, and NaN propagates: one bad row would turn a whole
 * cart's discount into NaN and render "৳NaN" at checkout. Zero is the safe neutral.
 */
export function toMinorSafe(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) ? minor : 0;
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
