/**
 * Parsing for the dynamic `[id]` segment of admin route handlers.
 *
 * Why this exists: several admin handlers passed `Number(params.id)` straight into a Prisma
 * `where` clause. For any non-numeric segment — a trailing slash, a URL that lost a digit, a
 * client building a link from an empty variable, or a scanner probing `/api/admin/products/x` —
 * `Number()` yields `NaN`. Prisma does not send `NaN` to the database; it treats the argument as
 * absent and throws:
 *
 *   PrismaClientValidationError: Invalid `prisma.blogPost.findUnique()` invocation:
 *   { where: { + id: Int } }  Argument `id` is missing.
 *
 * Handlers without a surrounding try/catch (every GET here) let that escape as an unhandled
 * exception → HTTP 500. Handlers that do catch it answer 500 with `e.message`, which puts
 * internal model and field names in the response body.
 *
 * `app/api/admin/orders/[id]/route.ts` already guarded this correctly. This helper is the same
 * guard, lifted so the rest of the admin surface can share it instead of re-deriving it.
 *
 * Callers should run `requirePerm()` FIRST and only then validate the id, so an unauthenticated
 * caller keeps receiving 401 rather than learning that the id was malformed.
 */
/**
 * Parse an id that arrived in a request BODY or query string, where a JSON number is a
 * legitimate input — unlike a URL segment, which is always a string.
 */
export function parseIdValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === "string") return parseIdParam(raw);
  return null;
}

/**
 * Validate an array of ids from a request body.
 *
 * Returns [] when the field was omitted and null when it is present but malformed. The
 * distinction matters: callers must not read "absent" as "clear every link", and must not
 * read "malformed" as "clear every link" either — that combination is exactly how a
 * collection lost all of its product links while the API answered {"ok":true}.
 */
export function parseIdList(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const item of raw) {
    const id = parseIdValue(item);
    if (id === null) return null;
    out.push(id);
  }
  return out;
}

export function parseIdParam(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  // Digits only. `Number()` alone would also accept "0x10" → 16, "1e3" → 1000, " 42 " → 42
  // and "42.0" → 42, so `/api/admin/products/0x10` would silently address product 16. A URL
  // segment carrying an id is a plain non-negative integer or it is not an id.
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
