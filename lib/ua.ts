/* Client IP resolution.

   WHY THIS IS NOT `xff.split(",")[0]`
   -----------------------------------
   X-Forwarded-For is a *chain* that every proxy APPENDS to. A client can send its
   own XFF header, and the reverse proxy (Traefik/Dokploy, nginx, a CDN) adds the
   real socket peer at the END. So the left-most value is 100% attacker-controlled:

       curl -H 'X-Forwarded-For: 8.8.8.8' https://shop/api/admin/login

   Taking that value made every rate limit in the app (admin login, customer login,
   password reset, review upload, newsletter, waitlist, checkout, tracking) bypassable
   with one header — a fresh bucket per request. Worse, `lib/risk.ts` auto-blacklists
   the IP that places too many orders, so an attacker could send 9 orders carrying a
   VICTIM's address in XFF and get that real customer's IP permanently blacklisted.

   The trustworthy value is counted from the RIGHT: skip `TRUSTED_PROXY_HOPS` proxies
   that you actually control, and whatever is left is the client. With a single
   Traefik in front of the app the default of 1 is correct. Put a CDN in front too
   and raise it (Cloudflare + Traefik = 2), or set TRUST_CLOUDFLARE=1 and the
   CF-Connecting-IP header is used directly.

   Anything that does not parse as an IP is discarded rather than trusted, and the
   result is clamped in length so it can never be used as an unbounded rate-limit
   key (see rateLimit() in lib/auth.ts). */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

/* Strip an IPv4-mapped IPv6 prefix and any zone id so "::ffff:1.2.3.4" and
   "fe80::1%eth0" normalise to something the rest of the app can compare. */
function normalizeIp(raw: string): string | null {
  let v = String(raw || "").trim();
  if (!v || v.length > 45) return null;
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  const zone = v.indexOf("%");
  if (zone > -1) v = v.slice(0, zone);
  if (/^::ffff:/i.test(v)) v = v.slice(7);
  if (!IPV4.test(v) && !IPV6.test(v.toLowerCase())) return null;
  return v;
}

function splitChain(header: string | null): string[] {
  if (!header) return [];
  return header.split(",").map((p) => p.trim()).filter(Boolean);
}

/* Number of proxies WE operate between the internet and this process.
   Traefik alone = 1 (default). Cloudflare in front of Traefik = 2. */
function trustedHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS);
  if (!Number.isFinite(n) || n < 1 || n > 10) return 1;
  return Math.floor(n);
}

export function getClientIp(req: Request): string {
  const headers = req.headers;

  // A CDN that terminates TLS for us states the client outright; trust it only when asked to.
  if (process.env.TRUST_CLOUDFLARE === "1") {
    const cf = normalizeIp(headers.get("cf-connecting-ip") || "");
    if (cf) return cf;
  }

  const chain = splitChain(headers.get("x-forwarded-for"));
  if (chain.length) {
    const hops = trustedHops();
    // index len-hops = the address our outermost trusted proxy actually saw.
    const idx = Math.max(0, chain.length - hops);
    const fromChain = normalizeIp(chain[idx]);
    if (fromChain) return fromChain;
    // A malformed entry means someone is injecting junk — fall through to the
    // socket-level header rather than trusting any other position in the chain.
  }

  const real = normalizeIp(headers.get("x-real-ip") || "");
  if (real) return real;

  /* Nothing usable. "0.0.0.0" is deliberate: lib/risk.ts treats it (and the RFC1918
     ranges) as non-blockable, so a proxy misconfiguration degrades to "no IP signal"
     instead of blacklisting every customer behind that proxy. */
  return "0.0.0.0";
}

export function detectSource(attr: any): string {
  const a = attr || {};
  const utm = (a.utm_source || "").toLowerCase();
  if (a.fbclid || a.fbp || a.fbc || utm.includes("facebook")) return "Facebook";
  if (utm.includes("instagram")) return "Instagram";
  if (utm.includes("google") || utm.includes("ads")) return "Google";
  if (utm) return utm;
  const ref = (a.referrer || "").toLowerCase();
  if (ref.includes("facebook") || ref.includes("fb.")) return "Facebook";
  if (ref.includes("instagram")) return "Instagram";
  if (ref.includes("google")) return "Organic";
  if (ref) return "Referral";
  return "Direct";
}
