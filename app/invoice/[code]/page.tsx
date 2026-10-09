import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { notFound } from "next/navigation";
import { parseOrderCode } from "@/lib/slug";
import { normalizeBDPhone } from "@/lib/phone";
import InvoicePhoneForm from "./phone-form";

export const dynamic = "force-dynamic";
const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

/* Public customer invoice — GATED by the order's phone number (PII protection).
   Order codes are sequential (ORD-XXXX), so without this gate anyone could
   enumerate every customer's name/phone/address. Only the buyer can view it. */
export default async function CustomerInvoice(
  props: { params: Promise<{ code: string }>; searchParams?: Promise<{ phone?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const id = parseOrderCode(params.code);
  if (id == null) notFound();

  const rawPhone = String(searchParams?.phone || "").replace(/[^0-9]/g, "");
  if (!rawPhone) {
    return <InvoicePhoneForm code={params.code} />;
  }
  // Accept 01XXXXXXXXX / +8801XXXXXXXXX / 8801XXXXXXXXX — normalize before compare
  const normPhone = normalizeBDPhone(rawPhone);

  const order = await db.order.findFirst({
    where: { id, phone: normPhone },
    include: { items: { include: { product: { include: { images: true } } } } },
  });
  if (!order) notFound();
  const s = await getSettings();
  const store = s.store || {};
  const deliveryDays = order.area === "INSIDE_DHAKA" ? "1–3 days" : "2–4 days";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", fontFamily: "Arial, sans-serif", color: "#111" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .inv-img { width: 72px; height: 90px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; }
        .inv-item { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid #eee; align-items: center; }
        .inv-spec { font-size: 12.5px; color: #666; margin-top: 3px; }
        @media print { .no-print { display: none !important; } }
      ` }} />
      <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={undefined} id="printbtn">🖨 Print / Save PDF</button>
        <a className="btn btn-outline" href="/">← Home</a>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #111", paddingBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="brand-wm" style={{ fontSize: 26, letterSpacing: "0.25em", fontWeight: 700 }}>{store.name || "TRENDING'S"}</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>{store.address}</div>
          <div style={{ fontSize: 12, color: "#555" }}>{store.phone} · {store.email}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>INVOICE</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{order.code}</div>
          <div style={{ fontSize: 12, color: "#555" }}>{new Date(order.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", margin: "22px 0", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#777", marginBottom: 6 }}>BILL TO</div>
          <div style={{ fontWeight: 700 }}>{order.name}</div>
          <div style={{ fontSize: 13 }}>{order.phone}</div>
          <div style={{ fontSize: 13, maxWidth: 340 }}>{order.address}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div>Payment: <b>{order.paymentMethod}</b> ({order.paymentStatus})</div>
          <div>Status: <b>{order.status}</b></div>
          <div>Delivery: {order.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"} ({deliveryDays})</div>
        </div>
      </div>

      <h3 style={{ fontSize: 16, margin: "10px 0 4px" }}>Item Details</h3>
      {order.items.map((i) => (
        <div className="inv-item" key={i.id}>
          {(() => {
            const img = i.image || i.product?.images?.[0]?.url;
            return img ? <img className="inv-img" src={img} alt={i.title} /> : <div className="inv-img" style={{ background: "#f4f2ef" }} />;
          })()}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{i.title}</div>
            {i.variant && <div className="inv-spec">Size: {i.variant.split(" · ")[0]}{i.variant.includes("·") ? " · Color: " + i.variant.split(" · ")[1] : ""}</div>}
            {i.product?.shortDesc && <div className="inv-spec">{i.product.shortDesc.slice(0, 90)}</div>}
            <div style={{ fontSize: 13, marginTop: 4 }}>Qty: {i.qty} &nbsp;&nbsp; ৳{Math.round(i.price).toLocaleString("en-IN")} × {i.qty} = <b>৳{Math.round(i.price * i.qty).toLocaleString("en-IN")}</b></div>
          </div>
        </div>
      ))}

      <h3 style={{ fontSize: 16, margin: "26px 0 10px" }}>Order Summary</h3>
      <div style={{ background: "#faf9f7", border: "1px solid #e5e1da", borderRadius: 8, padding: "18px 22px", maxWidth: 420, marginLeft: "auto", fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span>Subtotal</span><span>{money(order.subtotal)}</span></div>
        {order.discount > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#2e6b4f" }}><span>Discount {order.couponCode ? `(${order.couponCode})` : ""}</span><span>−{money(order.discount)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span>Vat / Tax</span><span>৳0</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span>Delivery Charge</span><span>{money(order.deliveryFee)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "2px solid #111", fontWeight: 700, fontSize: 16 }}><span>Grand Total</span><span>{money(order.total)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#555" }}><span>Paid Amount</span><span>৳0</span></div>
        {order.paymentMethod === "COD" && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#b3392f", fontWeight: 700 }}><span>Due Amount (COD)</span><span>{money(order.total)}</span></div>}
      </div>

      <div style={{ marginTop: 34, fontSize: 12, color: "#555", textAlign: "center", borderTop: "1px solid #ddd", paddingTop: 16 }}>
        Thank you for shopping with {store.name || "TRENDING'S"}! · {store.phone}<br />
        Returns accepted within 7 days · Support: {store.email}
      </div>
      <script dangerouslySetInnerHTML={{ __html: `document.getElementById("printbtn")?.addEventListener("click", () => window.print());` }} />
    </div>
  );
}
