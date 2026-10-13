/* lib/money.ts — toMinor() is the authoritative parser for admin-entered prices.
   Every case below is a real input the previous implementation got silently wrong:
   a Bengali-numeral price, a blank field, a negative, and multi-separator garbage all
   used to become a plausible-looking number instead of an error, and 0 means "free". */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const { toMinor, toMinorSafe, percentOfMinor, mulMinor, sumMinor } = loader()('lib/money.ts');

test('toMinor: plain ASCII prices', () => {
  assert.equal(toMinor('1299'), 129900);
  assert.equal(toMinor('1299.50'), 129950);
  assert.equal(toMinor('0.01'), 1);
  assert.equal(toMinor('0'), 0);
  assert.equal(toMinor('.5'), 50);
  assert.equal(toMinor(1299), 129900);
  assert.equal(toMinor(1299.5), 129950);
});

test('toMinor: thousands separators and currency symbols are decoration', () => {
  assert.equal(toMinor('1,299'), 129900);
  assert.equal(toMinor('1,299.50'), 129950);
  assert.equal(toMinor('৳1299'), 129900);
  assert.equal(toMinor('৳ 1,299.50'), 129950);
  assert.equal(toMinor('  1299  '), 129900);
  assert.equal(toMinor('$12.99', 'USD'), 1299);
});

test('toMinor: BENGALI numerals parse as the price they spell', () => {
  /* The headline fix. "১২৯৯" is 1299 on a Bengali keypad; the old
     replace(/[^\d.-]/g,'') stripped every one of those characters and returned 0,
     publishing the product at ৳0.00 — indistinguishable from a real free item. */
  assert.equal(toMinor('১২৯৯'), 129900);
  assert.equal(toMinor('১২৯৯.৫০'), 129950);
  assert.equal(toMinor('৳১,২৯৯'), 129900);
  assert.equal(toMinor('০'), 0);
});

test('toMinor: Devanagari numerals parse too (locale is en-IN)', () => {
  assert.equal(toMinor('१२९९'), 129900);
});

test('toMinor: unparseable input THROWS instead of becoming a ৳0.00 product', () => {
  for (const bad of ['', '   ', 'abc', '৳', '৳৳', 'N/A', '.', '..', '1.2.3', '1-2-3',
                     '12a99', '99 99', '1,2,3,4.5.6', 'e5', '0x10', 'Infinity', 'NaN', '{}',
                     'null', '1 299', '\\t1299\\n99']) {
    assert.throws(() => toMinor(bad), /Invalid amount/, `expected "${bad}" to throw`);
  }
  // '-' reports the clearer "must not be negative" message rather than a generic one
  assert.throws(() => toMinor('-'), /must not be negative/);
});

test('toMinor: negative amounts are rejected, not stored as credit', () => {
  /* -500 used to return -50000 and would have subtracted from an order total. */
  assert.throws(() => toMinor('-500'), /must not be negative/);
  assert.throws(() => toMinor('-0.01'), /must not be negative/);
  assert.throws(() => toMinor(-1), /must not be negative/);
  assert.throws(() => toMinor('৳-500'), /must not be negative/);
  assert.throws(() => toMinor('-0'), /must not be negative/);
});

test('toMinor: non-finite and out-of-range numbers throw', () => {
  assert.throws(() => toMinor(NaN), /Invalid amount/);
  assert.throws(() => toMinor(Infinity), /Invalid amount/);
  assert.throws(() => toMinor('1'.repeat(400)), /out of range/);
  assert.throws(() => toMinor(1e300), /out of range/);
});

test('toMinor: a decimal STRING rounds half-up, exactly, with no float multiply', () => {
  /* The module header promises "no accidental 1.005 * 100 truncation", and the float path it
     replaced did exactly that: 1.005 is stored as 1.00499999999999989, so Math.round(1.005*100)
     is 100 — a silent one-poisha loss. Parsing the digits as integers gives the 101 the admin
     meant. */
  assert.equal(toMinor('1.005'), 101);
  assert.equal(toMinor('12.999'), 1300);
  assert.equal(toMinor('0.005'), 1);
  assert.equal(toMinor('2.345'), 235);
  assert.equal(toMinor('1.004'), 100); // below the half → rounds down
  /* A JS number carries less information than the string: the double 1.005 IS
     1.00499999999999989, so 100 is the correct conversion of that value. The asymmetry is
     deliberate and documented at the call site — pass strings from forms, numbers from the DB. */
  assert.equal(toMinor(1.005), 100);
  assert.equal(toMinor(1.01), 101);
});

test('toMinorSafe: null-safe and NaN-safe for DB rows', () => {
  assert.equal(toMinorSafe(null), 0);
  assert.equal(toMinorSafe(undefined), 0);
  assert.equal(toMinorSafe(12.99), 1299);
  /* A Prisma Decimal or corrupt column must not leak NaN into a cart total,
     which would render "৳NaN" at checkout. */
  assert.equal(toMinorSafe(NaN), 0);
  assert.equal(toMinorSafe(Infinity), 0);
  assert.equal(toMinorSafe(-Infinity), 0);
});

test('percentOfMinor: basis points, half-up, integer result', () => {
  assert.equal(percentOfMinor(100000, 10), 10000);
  assert.equal(percentOfMinor(100000, 12.5), 12500);
  assert.equal(percentOfMinor(999, 33.33), 333);
  assert.equal(percentOfMinor(1, 100), 1);
  assert.throws(() => percentOfMinor(1.5, 10), /integer/);
});

test('mulMinor / sumMinor assert the integer invariant the engine relies on', () => {
  assert.equal(mulMinor(1299, 3), 3897);
  assert.equal(sumMinor([100, 200, 300]), 600);
  assert.equal(sumMinor([]), 0);
  assert.throws(() => mulMinor(1299, 1.5), /integer/);
  assert.throws(() => mulMinor(12.5, 2), /integer/);
  assert.throws(() => sumMinor([1, 2.5]), /integer/);
});
