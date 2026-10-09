import crypto from "crypto";

/* TOTP (RFC 6238) with SHA-1 / 6 digits / 30 s — what Google Authenticator, Authy and
   1Password all expect, so no app-specific setup is needed. Implemented with node crypto
   instead of a dependency. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function codeFor(secret: string, step = Math.floor(Date.now() / 30000)): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step % 2 ** 32, 4);
  const hmac = crypto.createHmac("sha1", new Uint8Array(key)).update(new Uint8Array(counter)).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

/** One step either side, so a slightly-off phone clock still works. */
export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const t = String(token || "").replace(/\D/g, "");
  if (t.length !== 6) return false;
  const now = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    const want = codeFor(secret, now + i);
    if (want.length === t.length && crypto.timingSafeEqual(new TextEncoder().encode(want), new TextEncoder().encode(t))) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string, issuer = "TRENDING'S Admin"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Recovery codes: printed once, hashed in the DB, each usable a single time. */
export function newRecoveryCodes(n = 6): string[] {
  return Array.from({ length: n }, () => crypto.randomBytes(5).toString("hex").match(/.{1,5}/g)!.join("-"));
}
export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(String(code).trim().toLowerCase()).digest("hex");
}
