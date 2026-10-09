import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { waitlistStats } from "@/lib/waitlist";
import { waStatus } from "@/lib/wa";
import { FEATURES } from "@/lib/features";
import WaitlistClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Waitlist" };

/* Everyone who asked to be told when a sold-out piece comes back.
   A sold-out page is a lost sale; this is the list that turns it into a second chance —
   and the restock screen pings them automatically (lib/waitlist.ts). */
export default async function WaitlistPage(props: { searchParams: Promise<{ t?: string; product?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "products");
  const productId = Number(searchParams.product || 0);
  const rows = await db.waitlist.findMany({
    where: productId ? { productId } : {},
    orderBy: { id: "desc" }, take: 300,
    include: { product: { select: { id: true, title: true, slug: true, stock: true } } },
  });
  const stats = await waitlistStats();
  const wa = await waStatus().catch(() => ({ running: false, connected: false }));

  // products with the most people waiting — the restock priority list
  const grouped = new Map<number, { title: string; slug: string; stock: number; count: number; pending: number }>();
  const all = await db.waitlist.findMany({ orderBy: { id: "desc" }, include: { product: { select: { id: true, title: true, slug: true, stock: true } } } });
  for (const w of all) {
    const cur = grouped.get(w.productId) || { title: w.product?.title || "#" + w.productId, slug: w.product?.slug || "", stock: w.product?.stock ?? 0, count: 0, pending: 0 };
    cur.count++;
    if (!w.notifiedAt) cur.pending++;
    grouped.set(w.productId, cur);
  }
  const top = Array.from(grouped.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.pending - a.pending || b.count - a.count).slice(0, 12);

  const rowsOut = rows.map((r) => ({
    id: r.id, contact: r.contact, note: r.note, notifiedAt: r.notifiedAt?.toISOString() || null,
    createdAt: r.createdAt.toISOString(), productId: r.productId,
    productTitle: r.product?.title || "#" + r.productId, stock: r.product?.stock ?? 0, slug: r.product?.slug || "",
  }));

  return (
    <>
      <div className="admin-top">
        <div><h1>Waitlist</h1><div className="who">{stats.pending} waiting · {stats.total} total signups · {user.name}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="abtn" href="/api/admin/export?type=waitlist">CSV</a>
          <a className="abtn" href="/admin/stock">Restock</a>
        </div>
      </div>

      {/* KPI row — WhatsApp bridge card ta sudhu adminWhatsapp on thakle dekhabe (lib/features.ts) */}
      <div className={"kpis kpis-" + (FEATURES.adminWhatsapp ? 4 : 3)} style={{ gridTemplateColumns: `repeat(${FEATURES.adminWhatsapp ? 4 : 3}, 1fr)` }}>
        <div className="kpi"><div className="k-label">Waiting now</div><div className="k-val">{stats.pending}</div><div className="k-sub">notified hoy ni</div></div>
        <div className="kpi"><div className="k-label">Products affected</div><div className="k-val">{stats.products}</div><div className="k-sub">restock priority</div></div>
        <div className="kpi"><div className="k-label">Total signups</div><div className="k-val">{stats.total}</div><div className="k-sub">all time</div></div>
        {FEATURES.adminWhatsapp && (
          <div className="kpi"><div className="k-label">WhatsApp bridge</div><div className="k-val">{wa.connected ? "Connected" : wa.running ? "Not linked" : "Off"}</div><div className="k-sub">{wa.connected ? "auto notify cholbe" : "SMS/email fallback"}</div></div>
        )}
      </div>

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start"  }}>
        <div className="acard">
          <div className="acard-h">
            <h3>{productId ? "Entries for one product" : "All entries"}</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{rowsOut.length} shown · newest first</span>
          </div>
          <div className="acard-b">
            <WaitlistClient rows={rowsOut} productId={productId} />
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>Restock priority</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>most people waiting first</span></div>
          <div className="acard-b" style={{ fontSize: 13 }}>
            {top.length === 0 ? <div style={{ color: "var(--muted)" }}>Nobody is waiting yet. A sold-out product page now shows a “notify me” box.</div> : top.map((t) => (
              <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={`/admin/waitlist?product=${t.id}`}>{t.title}</a>
                  <div style={{ fontSize: 11.5, color: t.stock <= 0 ? "var(--ad-red, #b42318)" : "var(--muted)" }}>
                    stock {t.stock} · {t.count} signup{t.count === 1 ? "" : "s"}{t.pending ? ` · ${t.pending} waiting` : ""}
                  </div>
                </div>
                <a className="abtn sm" href={`/admin/products?edit=${t.id}`}>Restock</a>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        Notify uses whatever channel the shop has: {FEATURES.adminWhatsapp && "WhatsApp bridge → "}SMS gateway → email. Anything that could not be
        sent automatically is kept on the list with a tap-to-send link, so nothing is silently dropped. Restocking a
        product from <a href="/admin/stock">Stock</a> pings everyone waiting for it in the same request.
      </div>
    </>
  );
}
