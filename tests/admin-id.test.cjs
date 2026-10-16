/* Regression tests for lib/admin-id.ts — the [id] segment guard on admin route handlers.

   Why these exist: thirteen admin `[id]` handlers passed `Number(params.id)` straight into a
   Prisma `where` clause. For any non-numeric segment, `Number()` yields NaN, Prisma treats the
   argument as absent and throws PrismaClientValidationError. Measured against the running app
   before the fix:

     GET    /api/admin/blog/route                     → 500  (unhandled, empty body)
     GET    /api/admin/campaigns/route                → 500  (unhandled, empty body)
     GET    /api/admin/whatsapp/broadcasts/route      → 500  (unhandled, empty body)
     GET    /api/admin/orders/route/payments          → 500  (unhandled, empty body)
     PUT    /api/admin/reviews/route                  → 500
     DELETE /api/admin/reviews/route                  → 500
     PUT    /api/admin/users/route                    → 500
     DELETE /api/admin/users/route                    → 500
     PUT    /api/admin/coupons/route                  → 500
     DELETE /api/admin/coupons/route                  → 500
     POST   /api/admin/orders/route/courier           → 500
     POST   /api/admin/orders/route/fraudcheck        → 500
     POST   /api/admin/products/route/duplicate       → 500, and the body carried the raw
                                                        PrismaClientValidationError text —
                                                        internal model and field names
     PUT    /api/admin/products/route                 → 500, same leak
     DELETE /api/admin/collections/route              → 200 {"ok":true}  — reported a
     DELETE /api/admin/categories/route               → 200 {"ok":true}     successful delete
                                                        while deleting nothing, because the
                                                        call was wrapped in .catch(() => {})

   (`/api/admin/<something>/route` is what a client reaches when the id segment is the literal
   string "route" — i.e. exactly the shape a scanner or a link built from an empty variable
   produces.)

   Run with: npm run test:unit   (node --test tests/*.test.cjs) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const { parseIdParam } = loader()('lib/admin-id.ts');

test('parseIdParam accepts plain positive integer segments', () => {
  for (const [input, want] of [['1', 1], ['7', 7], ['42', 42], ['999999', 999999]]) {
    assert.equal(parseIdParam(input), want, `${JSON.stringify(input)} should parse to ${want}`);
  }
});

test('parseIdParam rejects the non-numeric segment that caused the 500s', () => {
  // "route" is the literal segment that produced every measured failure above.
  assert.equal(parseIdParam('route'), null);
  for (const bad of ['abc', '', ' ', 'null', 'undefined', 'NaN', '-', 'x1', '1x', '%20', 'id']) {
    assert.equal(parseIdParam(bad), null, `${JSON.stringify(bad)} must be rejected`);
  }
});

test('parseIdParam rejects the loose coercions Number() would have accepted', () => {
  // Each of these reaches a DIFFERENT row than the one the URL appears to name.
  assert.equal(parseIdParam('0x10'), null, 'hex must not silently address product 16');
  assert.equal(parseIdParam('1e3'), null, 'exponent notation must not address row 1000');
  assert.equal(parseIdParam(' 42 '), null, 'surrounding whitespace must not be trimmed away');
  assert.equal(parseIdParam('42.0'), null, 'a fractional literal is not an id');
  assert.equal(parseIdParam('42.5'), null);
  assert.equal(parseIdParam('+42'), null, 'a sign prefix is not a plain integer segment');
});

test('parseIdParam rejects zero, negatives and out-of-range values', () => {
  assert.equal(parseIdParam('0'), null, 'row ids start at 1; 0 must not reach Prisma');
  assert.equal(parseIdParam('-1'), null);
  assert.equal(parseIdParam('-42'), null);
  // Beyond Number.MAX_SAFE_INTEGER, distinct ids collapse onto the same value.
  assert.equal(parseIdParam('9007199254740993'), null);
  assert.equal(parseIdParam('1'.repeat(400)), null, 'an arbitrarily long digit run must be refused');
  assert.equal(parseIdParam('Infinity'), null);
});

test('parseIdParam rejects every non-string input', () => {
  // A handler that forgets `await props.params` passes a Promise here; that must not
  // become NaN-and-then-500 either.
  for (const bad of [null, undefined, 42, 0, -1, NaN, Infinity, true, false, {}, [], ['1'], Promise.resolve('1')]) {
    assert.equal(parseIdParam(bad), null, `${String(bad)} (${typeof bad}) must be rejected`);
  }
});

test('parseIdParam never returns NaN — the value that Prisma drops from a where clause', () => {
  // This is the invariant the whole fix rests on: a caller may only ever hand Prisma a
  // number this function returned, and no such number is NaN.
  const inputs = ['route', '', '0x10', '1e3', '-1', '0', '42.5', null, undefined, NaN, {}, '9007199254740993'];
  for (const i of inputs) {
    const r = parseIdParam(i);
    assert.ok(r === null || (typeof r === 'number' && Number.isSafeInteger(r) && r > 0),
      `parseIdParam(${JSON.stringify(i)}) returned ${r}, which is neither null nor a safe positive integer`);
    assert.ok(!Number.isNaN(r), `parseIdParam(${JSON.stringify(i)}) returned NaN`);
  }
});
