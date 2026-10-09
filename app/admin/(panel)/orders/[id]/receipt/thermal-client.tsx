"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/settings";

/* Thermal receipt — optimized for Tigo POS-5820DD (58mm, 203dpi, Bluetooth/USB).
   - Pure ESC/POS-safe monospace layout (no images, no gradients)
   - Uses window.print() with exact 58mm @page — mobile Chrome/Android prints
     via system print service (works with Bluetooth thermal printers paired
     through the manufacturer's print service app)
   - Also renders text-only fallback for maximum compatibility */
export default function ThermalClient({ order, store, width }: { order: any; store: any; width: number }) {
  const [printing, setPrinting] = useState(false);
  const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");
  const line = "--------------------------------";

  const print = async () => {
    setPrinting(true);
    // small delay so the button state renders before the print dialog opens
    setTimeout(() => { window.print(); setPrinting(false); }, 150);
  };

  const consignment = (() => { try { return JSON.parse(order.courierTracking || "{}"); } catch { return {}; } })();

  return (
    <div style={{ background: "#f6f7f9", minHeight: "100vh", padding: 12 }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: 58mm auto; margin: 1mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .twrap { max-width: 56mm; margin: 0 auto; }
        .no-print { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-bottom: 14px; }
        .no-print .btn { min-width: 0; padding: 12px 18px; font-size: 11px; letter-spacing: .1em; }
        .receipt {
          background: #fff; color: #000; padding: 10px 8px;
          font-family: "Courier New", "Courier", monospace;
          font-size: 11px; line-height: 1.5; font-weight: 500;
        }
        .receipt .ctr { text-align: center; }
        .receipt .dash { border-top: 1px dashed #000; margin: 7px 0; }
        .receipt .b { font-weight: 900; }
        .receipt .xl { font-size: 1.4em; font-weight: 900; letter-spacing: .25em; }
        .receipt .big { font-size: 1.25em; font-weight: 900; }
        .receipt .huge { font-size: 1.5em; font-weight: 900; word-break: break-all; }
        .receipt table { width: 100%; border-collapse: collapse; }
        .receipt td { padding: 2px 0; vertical-align: top; font-size: inherit; }
        .receipt .rt { text-align: right; white-space: nowrap; }
        @media print {
          body { background: #fff; margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .twrap { max-width: none; }
          .receipt { box-shadow: none; padding: 0; }
        }
      ` }} />

      {/* action buttons — hidden when printing */}
      <div className="no-print">
        <button className="btn" onClick={print} disabled={printing} style={{ background: "#000", color: "#fff", border: "none" }}>
          {printing ? "Opening print…" : "🖨 PRINT RECEIPT"}
        </button>
        <a className="btn btn-outline" href={`/admin/orders/${order.id}`}>← BACK</a>
        <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center", width: "100%", textAlign: "center", display: "block", marginTop: 4 }}>
          58mm thermal · Tigo POS-5820DD compatible · print via Bluetooth/USB print service
        </span>
      </div>

      {/* receipt body */}
      <div className="twrap">
        <div className="receipt">
          <div className="ctr xl brand-wm">{store.name || "TRENDING'S"}</div>
          {store.phone && <div className="ctr">{store.phone}</div>}
          <div className="dash" />
          <div><span className="b">{order.code}</span> · {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })} {new Date(order.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
          <div className="dash" />
          <div className="b">CUSTOMER</div>
          <div>{order.name}</div>
          <div className="big">{order.phone}</div>
          <div>{order.area === "INSIDE_DHAKA" ? "INSIDE DHAKA" : "OUTSIDE DHAKA"}</div>
          <div className="dash" />

          <div className="b">ITEMS ({order.items.length})</div>
          {order.items.map((i: any) => (
            <div key={i.id} style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="b">{i.title}</span>
                <span className="rt b">{money(i.price * i.qty)}</span>
              </div>
              {i.variant && <div style={{ fontSize: ".9em" }}>Size: {i.variant}</div>}
              <div style={{ fontSize: ".9em", color: "#333" }}>{i.qty} x {money(i.price)}</div>
            </div>
          ))}

          <div className="dash" />
          <table>
            <tr><td>Subtotal</td><td className="rt">{money(order.subtotal)}</td></tr>
            {order.discount > 0 && <tr><td>Discount</td><td className="rt">-{money(order.discount)}</td></tr>}
            <tr><td>Delivery</td><td className="rt">{money(order.deliveryFee)}</td></tr>
            <tr><td className="big">TOTAL ({order.paymentMethod})</td><td className="rt big">{money(order.total)}</td></tr>
          </table>

          <div className="dash" />
          <div className="ctr b">
            {order.paymentMethod === "COD" ? `** CASH ON DELIVERY ${money(order.total)} **` : `** PAID ${money(order.total)} **`}
          </div>

          {order.courierConsignmentId && (
            <>
              <div className="dash" />
              <div>Courier: {order.courierName || "Steadfast"}</div>
              <div>Consignment ID:</div>
              <div className="ctr huge">{order.courierConsignmentId}</div>
            </>
          )}

          <div className="dash" />
          <div className="ctr">Thank you for shopping with us!</div>
          {store.phone && <div className="ctr">{store.phone}</div>}
        </div>
      </div>
    </div>
  );
}
