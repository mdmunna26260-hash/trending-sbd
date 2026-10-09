import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

/* Printable packing slip with a QR of the order code — the packer scans it on
   admin → Scan-to-pack, so nobody types a code by hand. */
export default async function Slip(props: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireAdmin(searchParams, "orders");
  const o = await db.order.findUnique({ where: { id: Number(params.id) }, include: { items: true } });
  if (!o) notFound();
  const qr = await QRCode.toDataURL(o.code, { margin: 1, width: 220 });
  const money = (n: number) => "৳" + Number(n || 0).toLocaleString("en-IN");
  return (
    <div className="slip-wrap">
      <div className="slip-actions no-print">
        <a className="abtn" href={`/admin/orders/${o.id}`}>← Order</a>
        <button className="abtn primary" id="slip-print">🖨 Print</button>
      </div>
      <div className="slip">
        <div className="slip-head">
          <div>
            <div className="slip-brand">TRENDING&apos;S</div>
            <div className="slip-sub">Packing slip</div>
          </div>
          <img src={qr} alt={"QR " + o.code} width={110} height={110} />
        </div>
        <div className="slip-code">{o.code}</div>
        <div className="slip-grid">
          <div><b>Deliver to</b><br />{o.name}<br />{o.phone}<br />{o.address}<br />{o.area}</div>
          <div>
            <b>Details</b><br />
            Placed: {new Date(o.createdAt).toLocaleString("en-GB")}<br />
            Payment: {o.paymentMethod} · {o.paymentStatus}<br />
            Courier: {o.courierName || "—"} {o.courierConsignmentId ? `(${o.courierConsignmentId})` : ""}<br />
            <span className="slip-cod">Collect on delivery: {money(o.total)}</span>
          </div>
        </div>
        <table className="slip-items">
          <thead><tr><th>Item</th><th>Qty</th><th style={{ textAlign: "right" }}>Price</th></tr></thead>
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id}>
                <td>{it.title}{it.variant ? ` — ${it.variant}` : ""}</td>
                <td>{it.qty}</td>
                <td style={{ textAlign: "right" }}>{money(it.price * it.qty)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Delivery</td><td style={{ textAlign: "right" }}>{money(o.deliveryFee)}</td></tr>
            {o.discount > 0 && <tr><td colSpan={2}>Discount</td><td style={{ textAlign: "right" }}>−{money(o.discount)}</td></tr>}
            <tr><td colSpan={2}><b>Total</b></td><td style={{ textAlign: "right" }}><b>{money(o.total)}</b></td></tr>
          </tfoot>
        </table>
        {o.notes && <div className="slip-note">Customer note: {o.notes}</div>}
        <div className="slip-foot">Checked by ____________________　Packed by ____________________</div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('slip-print').onclick=function(){window.print()}" }} />
    </div>
  );
}
