import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";

/* CSV writer.

   Quoting alone is not enough. A cell that begins with `=`, `+`, `-`, `@`, TAB or CR is
   interpreted as a FORMULA by Excel and LibreOffice, so a value a customer typed is
   executed on the machine of whoever opens the export. Every column below except the
   numeric ones is user-supplied — order name/address/phone, waitlist contact and note,
   product title, payment note — which makes this a plain "customer attacks admin" path
   (CWE-1236):

       name:  =cmd|' /C calc'!A0            → command execution on open
       name:  =HYPERLINK("http://evil","Click for invoice")  → credential phishing
       note:  =1+1  /  @SUM(A1)             → silent data exfiltration helper

   Prefixing a leading quote-mark (or a space) makes the cell inert text in both
   spreadsheets while staying readable. Applied to every cell, so nothing has to be
   remembered per column. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
function safeCell(value: unknown): string {
  const raw = String(value ?? "");
  const neutralised = FORMULA_LEAD.test(raw) ? "'" + raw : raw;
  // Strip bare CR/LF as well: inside quotes they are legal CSV, but they break naive
  // parsers and let one cell masquerade as several rows.
  return `"${neutralised.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
}
function csv(rows: any[][]): string {
  return rows.map((r) => r.map(safeCell).join(",")).join("\n");
}
export async function GET(req: Request) {
  const type = new URL(req.url).searchParams.get("type") || "orders";
  const PERM: Record<string, string> = { products: "products", payments: "orders", waitlist: "products", loyalty: "customers", logs: "settings" };
  const g = await requirePerm(PERM[type] || "orders", req);
  if ("res" in g) return g.res;
  let rows: any[][] = [];
  if (type === "orders") {
    // skip poison rows instead of failing the whole export
    let orders: any[] = [];
    try {
      orders = await db.order.findMany({ include: { items: true }, orderBy: { id: "desc" } });
    } catch {
      const ids = await db.order.findMany({ select: { id: true }, orderBy: { id: "desc" } });
      for (const { id } of ids) {
        try { orders.push(await db.order.findUnique({ where: { id }, include: { items: true } })); } catch {}
      }
      orders = orders.filter(Boolean);
    }
    rows = [["Code", "Date", "Name", "Phone", "Address", "Area", "Items", "Subtotal", "Discount", "Delivery", "Total", "Payment", "Status", "Risk", "Source"]];
    for (const o of orders) rows.push([o.code, o.createdAt.toISOString(), o.name, o.phone, o.address, o.area, o.items.map((i) => `${i.title} x${i.qty}`).join("; "), o.subtotal, o.discount, o.deliveryFee, o.total, o.paymentMethod + "/" + o.paymentStatus, o.status, o.riskLevel, o.source]);
  } else if (type === "products") {
    const ps = await db.product.findMany({ include: { category: true } });
    rows = [["ID", "Title", "SKU", "Category", "Price", "ComparePrice", "Stock", "Status", "Featured", "Views"]];
    for (const p of ps) rows.push([p.id, p.title, p.sku, p.category?.name, p.price, p.comparePrice, p.stock, p.status, p.featured, p.views]);
  } else if (type === "customers") {
    const cs = await db.customer.findMany({ include: { orders: true } });
    rows = [["Phone", "Name", "Email", "Address", "Orders", "TotalSpent", "LastOrder"]];
    for (const c of cs) rows.push([c.phone, c.name, c.email, c.address, c.orders.length, c.orders.reduce((a, o) => a + (o.status !== "CANCELLED" ? o.total : 0), 0), c.orders.sort((a, b) => b.id - a.id)[0]?.createdAt?.toISOString() || ""]);
  } else if (type === "subscribers") {
    const ss = await db.subscriber.findMany({ orderBy: { id: "desc" } });
    rows = [["Email", "Date"]]; for (const x of ss) rows.push([x.email, x.createdAt.toISOString()]);
  } else if (type === "coupons") {
    const cs = await db.coupon.findMany();
    rows = [["Code", "Type", "Value", "Used", "Limit", "Active"]]; for (const c of cs) rows.push([c.code, c.type, c.value, c.usedCount, c.usageLimit, c.active]);
  } else if (type === "payments") {
    const ps = await db.payment.findMany({ include: { order: true }, orderBy: { id: "desc" } });
    rows = [["When", "Order", "Customer", "Kind", "Method", "Amount", "By", "Note"]];
    for (const p of ps) rows.push([p.createdAt.toISOString(), p.order?.code, p.order?.name, p.kind, p.method, p.amount, p.createdBy, p.note]);
  } else if (type === "waitlist") {
    const ws = await db.waitlist.findMany({ include: { product: true }, orderBy: { id: "desc" } });
    rows = [["Added", "Product", "Contact", "Note", "Notified"]];
    for (const w of ws) rows.push([w.createdAt.toISOString(), w.product?.title, w.contact, w.note, w.notifiedAt?.toISOString() || ""]);
  } else if (type === "loyalty") {
    const cs = await db.customer.findMany({ orderBy: { points: "desc" } });
    rows = [["Name", "Phone", "Points", "Referral code", "Referred by", "Rewarded"]];
    for (const c of cs) rows.push([c.name, c.phone, c.points, c.referralCode, c.referredBy, c.referralRewardedAt?.toISOString() || ""]);
  } else { return new Response("Unknown type", { status: 400 }); }
  return new Response("\ufeff" + csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}-${Date.now()}.csv"` } });
}
