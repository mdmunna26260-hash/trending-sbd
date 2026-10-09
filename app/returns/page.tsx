import { Header, Footer } from "@/components/chrome";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { readPolicy } from "@/lib/policy";
import { waLink, telLink } from "@/lib/phone";
import { FEATURES } from "@/lib/features";
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Returns & Exchange",
  description:
    "How to return or exchange a TRENDING'S order: the return window, who pays the return courier, how refunds work for cash-on-delivery orders, and the delivery charges.",
  alternates: { canonical: "/returns" },
};

/* The policy page. Every number on it comes from admin → Policies (lib/policy.ts) so this page
   and the MerchantReturnPolicy in the PDP's structured data can never drift apart, and the
   delivery block comes from the same shipping settings the checkout charges from. */
export default async function ReturnsPage() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const store: any = cfg.store || {};
  const ship: any = s.shipping || {};
  const pol = readPolicy(s);

  const cur = store.currencySymbol || "৳";
  const money = (n: any) => cur + Math.round(Number(n) || 0).toLocaleString("en-IN");
  const wa = store.whatsapp ? waLink(store.whatsapp) : "";
  /* freeDelivery off (lib/features.ts) ⇒ freeAt 0 ⇒ "Delivery is free over ৳X" note ar
     refund-er free-delivery sentence dutoi render hoy na. */
  const freeAt = FEATURES.freeDelivery ? Number(ship.freeShippingThreshold) || 0 : 0;

  const facts = [
    { big: `${pol.returnDays} days`, small: "from the day it reaches you" },
    pol.freeReturnCourier
      ? { big: "Free", small: "return courier, we book it" }
      : { big: "You send", small: "return courier charges are yours" },
    { big: pol.refundTime, small: "to get your money back" },
    { big: `${pol.damageReportHours} hours`, small: "to report a wrong or damaged item" },
  ];

  const nav = [
    ["window", "How long you have"],
    ["start", "How to start a return"],
    ["exchange", "Exchanges"],
    ["refund", "Refunds"],
    ["damaged", "Wrong or damaged item"],
    ["not-accepted", "What we can't accept"],
    ["delivery", "Delivery charges"],
    ["contact", "Talk to us"],
  ];

  const steps = [
    {
      t: "Message us with your order code",
      d: `WhatsApp or call ${store.phone || "our support number"}${store.email ? `, or email ${store.email}` : ""}. Send the order code (it looks like ORD-1234 — you can also find it on the Track Order page) and which item it is.`,
    },
    {
      t: "Tell us what you'd like",
      d: "Another size, another colour, a different product, or your money back. If it's a size or colour swap, say which — we check stock before we book the courier.",
    },
    {
      t: "Keep it packed",
      d: "Don't wear, wash or alter it. Keep the tags and the original packaging, and put the invoice in the parcel if you still have it. Photos of the item help us process it faster.",
    },
    pol.freeReturnCourier
      ? { t: "We book the return courier", d: "Our courier (Steadfast) picks the parcel up from your address — you don't pay anything for that. Hand it over sealed." }
      : { t: "Send it back to us", d: `Drop the parcel with any courier to ${store.address || "our address"}. Return courier charges are on you.` },
    {
      t: "We check it and finish the job",
      d: `Once it reaches us we inspect it and confirm on WhatsApp. If it's an exchange, we send the replacement out as soon as that's confirmed; refunds are released within ${pol.refundTime} (see "Refunds" below).`,
    },
  ];

  return (
    <>
      <Header storeName={store.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container">
        <div className="policy-head">
          <div className="eyebrow">Help · Policies</div>
          <h1>Returns &amp; Exchange</h1>
          <p className="policy-lead">
            Something doesn&apos;t fit, doesn&apos;t suit you, or isn&apos;t what you expected? Send it back within{" "}
            {pol.returnDays} days and we&apos;ll exchange it or refund you. You order cash on delivery — you should
            not have to argue about a return.
          </p>
          <div className="policy-facts">
            {facts.map((f) => (
              <div className="policy-fact" key={f.small}>
                <b>{f.big}</b>
                <span>{f.small}</span>
              </div>
            ))}
          </div>
          <div className="policy-stamp">Last updated {pol.updated}</div>
        </div>

        <div className="policy-wrap">
          <nav className="policy-nav" aria-label="On this page">
            <div className="eyebrow">On this page</div>
            {nav.map(([id, label]) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </nav>

          <div className="policy">
            <section id="window">
              <h2>How long you have</h2>
              <p>
                You have <b>{pol.returnDays} days from the day the parcel is delivered</b> to tell us you want to
                return an item — not from the day you ordered. The delivery date is the one our courier reports and
                the one shown on the Track Order page, so there is no dispute about when the clock started.
              </p>
              <p>
                Within that window the item should still be in the condition you received it: unworn, unwashed,
                unaltered, with its tags and packaging. Trying a shirt on is normal — wearing it to a function is not.
              </p>
            </section>

            <section id="start">
              <h2>How to start a return</h2>
              <ol className="steps">
                {steps.map((x) => (
                  <li key={x.t}>
                    <b>{x.t}</b>
                    <span>{x.d}</span>
                  </li>
                ))}
              </ol>
              <div className="policy-note">
                Please do not send a parcel back without messaging us first. An unannounced parcel has no order
                attached to it, so we can&apos;t tell whose return it is and it sits unprocessed.
              </div>
            </section>

            <section id="exchange">
              <h2>Exchanges</h2>
              <p>
                {pol.exchangeNote}
              </p>
              <p>
                If the size you need is out of stock we&apos;ll tell you straight away and you can either wait for a
                restock, take something else of the same value, or take the refund instead.
              </p>
            </section>

            <section id="refund">
              <h2>Refunds</h2>
              <p>
                Your order was paid cash on delivery, so the refund comes back to you through{" "}
                <b>{pol.refundMethod}</b> — whichever is easiest for you. We send it within{" "}
                <b>{pol.refundTime}</b> of the returned item reaching us and passing inspection. If you paid online
                instead, the refund goes back to the same account or card.
              </p>
              <p>
                On a change of mind, the delivery charge itself isn&apos;t refunded — that money went to the courier who
                brought the parcel to you — but you get the full price of the item back.{freeAt > 0 ? ` If the delivery was free because your order was over ${money(freeAt)}, there is nothing to deduct.` : ""}
              </p>
            </section>

            <section id="damaged">
              <h2>Wrong or damaged item</h2>
              <p>
                This is a different situation and we treat it differently. If the parcel arrives with the wrong item,
                the wrong size, a missing piece, or a defect, tell us <b>within {pol.damageReportHours} hours</b> of
                delivery and send a photo or a short video of what arrived.
              </p>
              <p>
                We fix those at our own cost — replacement, exchange, or a full refund including the delivery charge
                — and we usually sort it out without waiting for the item to travel back first. The faster you tell
                us, the easier it is to check what happened with the courier.
              </p>
            </section>

            <section id="not-accepted">
              <h2>What we can&apos;t accept</h2>
              <p>For hygiene, safety and fair pricing, a few things can&apos;t come back:</p>
              <ul className="policy-list">
                {pol.nonReturnable.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p>
                We also can&apos;t take an item back after the {pol.returnDays}-day window has passed, unless we agreed
                to an extension in writing on WhatsApp before it ran out.
              </p>
            </section>

            <section id="delivery">
              <h2>Delivery charges &amp; timing</h2>
              <p>These are the same numbers the checkout charges you — nothing extra appears later.</p>
              <table className="policy-table">
                <thead>
                  <tr><th>Where</th><th>Charge</th><th>Usually arrives</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Inside Dhaka</td>
                    <td>{Number(ship.insideDhaka) > 0 ? money(ship.insideDhaka) : "Free"}</td>
                    <td>{ship.estimateInside || "1–2 days"}</td>
                  </tr>
                  <tr>
                    <td>Outside Dhaka</td>
                    <td>{Number(ship.outsideDhaka) > 0 ? money(ship.outsideDhaka) : "Free"}</td>
                    <td>{ship.estimateOutside || "2–4 days"}</td>
                  </tr>
                </tbody>
              </table>
              {freeAt > 0 && (
                <p className="policy-note">
                  Delivery is free anywhere in Bangladesh on orders over <b>{money(freeAt)}</b>. Below that, the
                  charge above applies. Cash on delivery is available everywhere — you pay the courier when the
                  parcel reaches you.
                </p>
              )}
              <p>
                An exchange that&apos;s a straight size or colour swap is delivered free{pol.freeReturnCourier ? ", including the return leg" : ""}.
              </p>
            </section>

            {pol.note && (
              <section id="note">
                <h2>One more thing</h2>
                <p>{pol.note}</p>
              </section>
            )}

            <section id="contact">
              <h2>Talk to us</h2>
              <p>
                Returns are handled by a person, not a form. Message us and you&apos;ll get a reply with a name on it.
              </p>
              <div className="policy-cta">
                {wa && (
                  <a className="btn" href={wa} target="_blank" rel="noreferrer noopener" style={{ background: "var(--accent)", color: "#fff" }}>
                    WhatsApp us
                  </a>
                )}
                {store.phone && (
                  <a className="btn" href={telLink(store.phone)} style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
                    {store.phone}
                  </a>
                )}
                <Link className="btn" href="/track" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
                  Track your order
                </Link>
              </div>
              <dl className="policy-meta">
                {store.email && (<><dt>Email</dt><dd><a href={"mailto:" + store.email}>{store.email}</a></dd></>)}
                {store.address && (<><dt>Address</dt><dd>{store.address}</dd></>)}
              </dl>
            </section>
          </div>
        </div>
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
