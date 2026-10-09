import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function money(n: number) { return "৳" + Math.round(n).toLocaleString("en-IN"); }
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const IC = {
  banknote: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  chart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg>,
  bag: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 7h12l1 13H5L6 7zm3 0a3 3 0 0 1 6 0" /></svg>,
  hash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  box: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>,
  eye: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>,
  cart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 12.4A2 2 0 0 0 9.6 17H19l2-9H6" /></svg>,
};

/* tiny line sparkline for KPI cards */
function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const W = 120, H = 30;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(H - 3 - (v / max) * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="k-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--ad-green)" : "var(--ad-red)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity=".85" />
    </svg>
  );
}

/* gradient area chart (pure SVG — no chart lib) */
function AreaChart({ days }: { days: { label: string; total: number }[] }) {
  const W = 600, H = 170, P = 10;
  if (days.length < 2) return null;
  const max = Math.max(...days.map((d) => d.total), 1);
  const x = (i: number) => P + (i / (days.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P - 16);
  const line = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(" ");
  const area = `${line} L${x(days.length - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  return (
    <>
      <svg className="achart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="adArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ad-accent)" stopOpacity=".38" />
            <stop offset="100%" stopColor="var(--ad-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - 2 * P - 16)} y2={H - P - f * (H - 2 * P - 16)} stroke="var(--ad-line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#adArea)" />
        <path className="glow" d={line} fill="none" stroke="var(--ad-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => (
          <circle key={i} className="glow-dot" cx={x(i)} cy={y(d.total)} r="3" fill="var(--ad-card-solid, #101833)" stroke="var(--ad-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <title>{`${d.label}: ${money(d.total)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="achart-x">
        <span>{days[0]?.label}</span>
        <span>{days[Math.floor(days.length / 2)]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
    </>
  );
}

/* visits (area) vs orders (line) — the two series are scaled to their own max */
function TrafficChart({ days }: { days: { label: string; views: number; orders: number }[] }) {
  const W = 600, H = 170, P = 10;
  if (days.length < 2) return null;
  const maxV = Math.max(...days.map((d) => d.views), 1);
  const maxO = Math.max(...days.map((d) => d.orders), 1);
  const x = (i: number) => P + (i / (days.length - 1)) * (W - 2 * P);
  const yv = (v: number) => H - P - (v / maxV) * (H - 2 * P - 16);
  const yo = (v: number) => H - P - (v / maxO) * (H - 2 * P - 16);
  const vLine = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yv(d.views).toFixed(1)}`).join(" ");
  const oLine = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yo(d.orders).toFixed(1)}`).join(" ");
  const vArea = `${vLine} L${x(days.length - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  return (
    <>
      <svg className="achart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="adTraffic" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity=".30" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - 2 * P - 16)} y2={H - P - f * (H - 2 * P - 16)} stroke="var(--ad-line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={vArea} fill="url(#adTraffic)" />
        <path className="glow" d={vLine} fill="none" stroke="#22d3ee" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={oLine} fill="none" stroke="#8b5cf6" strokeWidth="2.2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => (
          <circle key={i} className="glow-dot" cx={x(i)} cy={yv(d.views)} r="2.6" fill="var(--ad-card-solid, #101833)" stroke="#22d3ee" strokeWidth="1.8" vectorEffect="non-scaling-stroke">
            <title>{`${d.label} · ${d.views} views · ${d.orders} order(s)`}</title>
          </circle>
        ))}
      </svg>
      <div className="achart-x">
        <span>{days[0]?.label}</span>
        <span>{days[Math.floor(days.length / 2)]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
      <div className="chart-legend" style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 12.5 }}>
        <span><i style={{ background: "#22d3ee" }} />Visits</span>
        <span><i style={{ background: "#8b5cf6" }} />Orders</span>
      </div>
    </>
  );
}

/* order-status donut */
const STATUS_COLOR: Record<string, string> = {
  PENDING: "#f6bd4b",
  CONFIRMED: "#6aa6ff",
  PROCESSING: "#6aa6ff",
  PACKED: "#b18cff",
  SHIPPED: "#4fd8ee",
  DELIVERED: "#4ade9b",
  CANCELLED: "#fb7d7d",
  RETURNED: "#fb7d7d",
  ON_HOLD: "#7a89b0",
  DRAFT: "#7a89b0",
};

function Donut({ slices, centerValue, centerLabel }: { slices: { label: string; value: number; color: string }[]; centerValue: string; centerLabel: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const drawn = slices.filter((s) => s.value > 0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
      <svg className="donut" width="156" height="156" viewBox="0 0 150 150" role="img" aria-label="Order status distribution">
        <circle cx="75" cy="75" r={R} fill="none" stroke="rgba(122,152,255,.14)" strokeWidth="15" />
        {total > 0 && drawn.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={s.label} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="15"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 75 75)" />
          );
          acc += len;
          return el;
        })}
        <text x="75" y="72" textAnchor="middle" fill="#eef2ff" style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{centerValue}</text>
        <text x="75" y="92" textAnchor="middle" fill="#7a89b0" style={{ fontSize: 11 }}>{centerLabel}</text>
      </svg>
      <ul className="chart-legend" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 9, fontSize: 12.5, minWidth: 168, flex: 1 }}>
        {drawn.map((s) => (
          <li key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i style={{ background: s.color }} />
            <span style={{ textTransform: "capitalize" }}>{s.label.toLowerCase()}</span>
            <b style={{ marginLeft: "auto", color: "#eef2ff", fontVariantNumeric: "tabular-nums" }}>{s.value}</b>
            <span style={{ color: "var(--ad-mute)", width: 34, textAlign: "right" }}>{pct(s.value, total)}%</span>
          </li>
        ))}
        {total === 0 && <li style={{ color: "var(--ad-mute)" }}>No orders yet</li>}
      </ul>
    </div>
  );
}

/* storefront funnel: PageView → ViewContent → AddToCart → Purchase */
function Funnel({ steps }: { steps: { label: string; value: number; tone: string }[] }) {
  const top = steps[0]?.value || 0;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {steps.map((s, i) => {
        const share = top > 0 ? (s.value / top) * 100 : 0;
        return (
          <div className="funnel-step" key={s.label} style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <b style={{ fontSize: 13.5 }}>{s.label}</b>
              <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{s.value}</span>
              <span style={{ color: "var(--ad-mute)", fontSize: 11.5, width: 46, textAlign: "right" }}>{pct(s.value, top)}%</span>
            </div>
            <div className="bar-track" style={{ height: 8 }}>
              <div className={"bar-fill " + s.tone} style={{ width: `${Math.max(share, s.value > 0 ? 4 : 0)}%`, height: "100%" }} />
            </div>
            {i > 0 && steps[i - 1].value > 0 && (
              <div style={{ color: "var(--ad-mute)", fontSize: 11.5, marginTop: 6 }}>
                {pct(s.value, steps[i - 1].value)}% pass from “{steps[i - 1].label}”
              </div>
            )}
          </div>
        );
      })}
      {top === 0 && <p className="promo-help" style={{ margin: 0 }}>Ekhono kono storefront event pai ni — site e ghurle ei funnel ta bhore jabe.</p>}
    </div>
  );
}

/* top products as glowing bars (thumbnail + units + revenue) */
function TopProducts({ rows }: { rows: { title: string; img: string; units: number; revenue: number }[] }) {
  const max = Math.max(...rows.map((r) => r.units), 1);
  if (rows.length === 0) return <p style={{ color: "var(--ad-mute)", margin: 0 }}>No sales yet — first order dile ekhane uthbe.</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
      {rows.map((r) => (
        <li key={r.title} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {r.img
            ? <img src={r.img} alt="" style={{ width: 40, height: 50, borderRadius: 10, objectFit: "cover", flex: "none" }} />
            : <div style={{ width: 40, height: 50, borderRadius: 10, background: "rgba(122,152,255,.12)", flex: "none" }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
              <b style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{r.units}</b>
            </div>
            <div className="bar-track" style={{ height: 7, margin: "7px 0 6px" }}>
              <div className="bar-fill" style={{ width: `${Math.max((r.units / max) * 100, 6)}%`, height: "100%" }} />
            </div>
            <div style={{ color: "var(--ad-mute)", fontSize: 11.5 }}>{money(r.revenue)} revenue</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* low-stock bars */
function LowStock({ rows }: { rows: { id: number; title: string; stock: number }[] }) {
  if (rows.length === 0) return <p style={{ color: "var(--ad-mute)", margin: 0 }}>Sob product e stock ache ✓</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 13 }}>
      {rows.map((p) => {
        const tone = p.stock <= 2 ? "bar-fill warm" : "bar-fill warm";
        return (
          <li key={p.id}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
              <b style={{ marginLeft: "auto", color: p.stock <= 2 ? "var(--ad-red)" : "var(--ad-amber)", fontVariantNumeric: "tabular-nums" }}>{p.stock} left</b>
            </div>
            <div className="bar-track" style={{ height: 7, marginTop: 6 }}>
              <div className={tone} style={{ width: `${Math.max((p.stock / 20) * 100, 5)}%`, height: "100%" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Delta({ now, prev, sub }: { now: number; prev: number; sub?: string }) {
  if (prev === 0 && now === 0) return <div className="k-delta flat">— <span className="vs">{sub}</span></div>;
  if (prev === 0) return <div className="k-delta up">▲ +100% <span className="vs">{sub}</span></div>;
  const p = ((now - prev) / prev) * 100;
  const up = p >= 0;
  return <div className={"k-delta " + (up ? "up" : "down")}>{up ? "▲" : "▼"} {Math.abs(p).toFixed(1)}% <span className="vs">{sub}</span></div>;
}

export default async function Dashboard(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "orders");
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const t = (searchParams?.t as string) || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1);
  const start7 = new Date(Date.now() - 7 * 86400000);
  const start14 = new Date(Date.now() - 14 * 86400000);
  const valid = { status: { notIn: ["CANCELLED"] } };

  const [todayAgg, weekAgg, allAgg, todayCount, allCount, customerCount, pendingCount, deliveredCount, cancelledCount, lowStock, recentOrders, topProducts,
    yesterdayAgg, prev7Agg, weekCount, prev7Count, statusGroups, funnelRows, pageViews, ordersPerDay] = await Promise.all([
    db.order.aggregate({ where: { ...valid, createdAt: { gte: startToday } }, _sum: { total: true } }),
    db.order.aggregate({ where: { ...valid, createdAt: { gte: start7 } }, _sum: { total: true } }),
    db.order.aggregate({ where: valid, _sum: { total: true } }),
    db.order.count({ where: { createdAt: { gte: startToday } } }),
    db.order.count(),
    db.customer.count(),
    db.order.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { status: "DELIVERED" } }),
    db.order.count({ where: { status: { in: ["CANCELLED", "RETURNED"] } } }),
    db.product.findMany({ where: { status: "ACTIVE", stock: { lte: 20 } }, orderBy: { stock: "asc" }, take: 5, select: { id: true, title: true, stock: true } }),
    db.order.findMany({ orderBy: { id: "desc" }, take: 8, include: { items: true } }),
    db.orderItem.groupBy({ by: ["productId", "title"], _count: { _all: true }, _sum: { qty: true }, orderBy: { _sum: { qty: "desc" } }, take: 5 }),
    db.order.aggregate({ where: { ...valid, createdAt: { gte: startYesterday, lt: startToday } }, _sum: { total: true } }),
    db.order.aggregate({ where: { ...valid, createdAt: { gte: start14, lt: start7 } }, _sum: { total: true } }),
    db.order.count({ where: { ...valid, createdAt: { gte: start7 } } }),
    db.order.count({ where: { ...valid, createdAt: { gte: start14, lt: start7 } } }),
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    db.trackingEvent.groupBy({ by: ["name"], _count: { _all: true }, where: { name: { in: ["PageView", "ViewContent", "AddToCart", "Purchase"] } } }),
    db.trackingEvent.findMany({ where: { name: "PageView", createdAt: { gte: new Date(Date.now() - 13 * 86400000) } }, select: { createdAt: true } }),
    db.order.findMany({ where: { createdAt: { gte: new Date(Date.now() - 13 * 86400000) }, status: { notIn: ["CANCELLED"] } }, select: { createdAt: true } }),
  ]);

  const topIds = topProducts.map((x) => x.productId).filter(Boolean) as number[];
  const [topImgs, topLines] = await Promise.all([
    topIds.length ? db.product.findMany({ where: { id: { in: topIds } }, select: { id: true, images: { select: { url: true }, take: 1 } } }) : Promise.resolve([]),
    topIds.length ? db.orderItem.findMany({ where: { productId: { in: topIds } }, select: { productId: true, price: true, qty: true } }) : Promise.resolve([]),
  ]);
  const topImg = new Map(topImgs.map((p) => [p.id, p.images?.[0]?.url || ""]));
  const topRevenue = new Map<number, number>();
  for (const l of topLines) if (l.productId) topRevenue.set(l.productId, (topRevenue.get(l.productId) || 0) + l.price * l.qty);

  // last 14 days — sales, visits, order counts
  const dayStart = new Date(Date.now() - 13 * 86400000); dayStart.setHours(0, 0, 0, 0);
  const ordersInRange = await db.order.findMany({ where: { createdAt: { gte: dayStart }, status: { notIn: ["CANCELLED"] } }, select: { createdAt: true, total: true } });
  const days: { label: string; total: number }[] = [];
  const trafficDays: { label: string; views: number; orders: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(dayStart.getTime() + i * 86400000);
    const next = new Date(d.getTime() + 86400000);
    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const inDay = ordersInRange.filter((o) => o.createdAt >= d && o.createdAt < next);
    days.push({ label, total: inDay.reduce((a, o) => a + o.total, 0) });
    trafficDays.push({
      label,
      views: pageViews.filter((p) => p.createdAt >= d && p.createdAt < next).length,
      orders: ordersPerDay.filter((o) => o.createdAt >= d && o.createdAt < next).length,
    });
  }
  const sum14 = days.reduce((a, d) => a + d.total, 0);
  const views14 = trafficDays.reduce((a, d) => a + d.views, 0);

  const funnelCount = new Map(funnelRows.map((r: any) => [r.name as string, r._count?._all ?? r._count ?? 0]));
  const funnel = [
    { label: "Page views", value: funnelCount.get("PageView") || 0, tone: "cool" },
    { label: "Product views", value: funnelCount.get("ViewContent") || 0, tone: "cool" },
    { label: "Add to cart", value: funnelCount.get("AddToCart") || 0, tone: "" },
    { label: "Purchase", value: funnelCount.get("Purchase") || 0, tone: "mint" },
  ];

  const statuses = (statusGroups as any[])
    .map((g) => ({ label: String(g.status), value: Number(g._count?._all ?? g._count ?? 0), color: STATUS_COLOR[String(g.status)] || "#7a89b0" }))
    .sort((a, b) => b.value - a.value);
  const statusTotal = statuses.reduce((s, x) => s + x.value, 0);

  const today = todayAgg._sum.total || 0;
  const yesterday = yesterdayAgg._sum.total || 0;
  const week = weekAgg._sum.total || 0;
  const prevWeek = prev7Agg._sum.total || 0;
  const total = allAgg._sum.total || 0;
  const aov = allCount ? total / allCount : 0;
  const aov7 = weekCount ? week / weekCount : 0;
  const aovPrev7 = prev7Count ? prevWeek / prev7Count : 0;
  const conversion = views14 > 0 ? ((days.reduce((a, d) => a + d.total, 0) > 0 ? funnelCount.get("Purchase") || 0 : 0) / views14) * 100 : 0;

  return (
    <>
      <div className="admin-top">
        <div><h1>Dashboard</h1><div className="who">Welcome back, {user.name} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div></div>
        <div className="admin-actions">
          <Link className="abtn" href="/" target="_blank">View Website</Link>
          <Link className="abtn" href={tk("/admin/products")}>+ Add Product</Link>
          <Link className="abtn primary" href={tk("/admin/orders")}>View Orders</Link>
        </div>
      </div>

      {/* KPI row 1 — sales with trends */}
      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><div className="k-label">Today&apos;s Sales</div><div className="k-ic indigo">{IC.banknote}</div></div>
          <div className="k-val">{money(today)}</div>
          <div className="k-sub">{todayCount} order{todayCount !== 1 ? "s" : ""} today</div>
          <Delta now={today} prev={yesterday} sub="vs yesterday" />
          <Spark data={days.map((d) => d.total)} up={today >= yesterday} />
        </div>
        <div className="kpi">
          <div className="k-top"><div className="k-label">7-Day Sales</div><div className="k-ic violet">{IC.chart}</div></div>
          <div className="k-val">{money(week)}</div>
          <div className="k-sub">{weekCount} orders · last 7 days</div>
          <Delta now={week} prev={prevWeek} sub="vs prev 7 days" />
          <Spark data={days.map((d) => d.total)} up={week >= prevWeek} />
        </div>
        <div className="kpi">
          <div className="k-top"><div className="k-label">Total Sales</div><div className="k-ic blue">{IC.bag}</div></div>
          <div className="k-val">{money(total)}</div>
          <div className="k-sub">{allCount} orders all-time</div>
        </div>
        <div className="kpi">
          <div className="k-top"><div className="k-label">Avg Order Value</div><div className="k-ic cyan">{IC.hash}</div></div>
          <div className="k-val">{money(aov)}</div>
          <div className="k-sub">all-time</div>
          <Delta now={aov7} prev={aovPrev7} sub="7-day vs prev 7-day" />
        </div>
      </div>

      {/* KPI row 2 — operational counts */}
      <div className="stat-strip dash-strip">
        <div className="kpi"><div className="k-top"><div className="k-label">Pending Orders</div><div className="k-ic amber">{IC.clock}</div></div><div className="k-val">{pendingCount}</div><div className="k-sub">needs confirmation</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Delivered</div><div className="k-ic green">{IC.check}</div></div><div className="k-val">{deliveredCount}</div><div className="k-sub">completed</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Cancelled / Returned</div><div className="k-ic red">{IC.x}</div></div><div className="k-val">{cancelledCount}</div><div className="k-sub">all-time</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Customers</div><div className="k-ic indigo">{IC.user}</div></div><div className="k-val">{customerCount}</div><div className="k-sub">total</div></div>
        <div className="kpi"><div className="k-top"><div className="k-label">Low Stock</div><div className="k-ic amber">{IC.box}</div></div><div className="k-val">{lowStock.length}</div><div className="k-sub">{lowStock.length ? "needs restock" : "all good"}</div></div>
      </div>

      {/* charts row — sales + traffic */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h">
            <h3>Sales — last 14 days</h3>
            <div style={{ fontSize: 12.5, color: "var(--ad-mute)", fontVariantNumeric: "tabular-nums" }}>Total {money(sum14)}</div>
          </div>
          <div className="acard-b"><AreaChart days={days} /></div>
        </div>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h">
            <h3>Traffic &amp; Orders — last 14 days</h3>
            <div style={{ fontSize: 12.5, color: "var(--ad-mute)", fontVariantNumeric: "tabular-nums" }}>{views14} visits · conv {conversion.toFixed(1)}%</div>
          </div>
          <div className="acard-b"><TrafficChart days={trafficDays} /></div>
        </div>
      </div>

      {/* funnel + status donut + low stock */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h"><h3>Storefront funnel</h3><span style={{ fontSize: 12, color: "var(--ad-mute)" }}>all events</span></div>
          <div className="acard-b"><Funnel steps={funnel} /></div>
        </div>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h"><h3>Order status</h3></div>
          <div className="acard-b"><Donut slices={statuses} centerValue={String(statusTotal)} centerLabel={statusTotal === 1 ? "order" : "orders"} /></div>
        </div>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h"><h3>Low stock alert</h3><Link className="abtn sm" href={tk("/admin/products")}>Restock</Link></div>
          <div className="acard-b"><LowStock rows={lowStock} /></div>
        </div>
      </div>

      {/* top products + recent orders */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h"><h3>Top Products</h3><span style={{ fontSize: 12, color: "var(--ad-mute)" }}>by units sold</span></div>
          <div className="acard-b">
            <TopProducts
              rows={topProducts.map((tp) => ({
                title: tp.title,
                img: tp.productId ? topImg.get(tp.productId) || "" : "",
                units: tp._sum.qty || 0,
                revenue: tp.productId ? topRevenue.get(tp.productId) || 0 : 0,
              }))}
            />
          </div>
        </div>
        <div className="acard" style={{ marginBottom: 0 }}>
          <div className="acard-h"><h3>Recent Orders</h3><Link className="abtn sm" href={tk("/admin/orders")}>All orders</Link></div>
          <div className="tbl-scroll tbl-sticky">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Risk</th><th></th></tr></thead>
              <tbody>
                {recentOrders.length === 0 && <tr><td colSpan={7} style={{ color: "var(--ad-mute)" }}>No orders yet — place a test order from the storefront!</td></tr>}
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {o.items[0]?.image ? <img src={o.items[0].image} alt="" /> : <div style={{ width: 38, height: 48, borderRadius: 6, background: "var(--ad-line-soft)", flex: "none" }} />}
                        <div>
                          <b>{o.code}</b>
                          <div style={{ fontSize: 12, color: "var(--ad-mute)" }}>{new Date(o.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                      </div>
                    </td>
                    <td>{o.name}<br /><span style={{ color: "var(--ad-mute)", fontSize: 12 }}>{o.phone}</span></td>
                    <td>{o.items.length}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}><b>{money(o.total)}</b></td>
                    <td><span className={"pill " + o.status}>{o.status}</span></td>
                    <td><span className={"risk-badge risk-" + o.riskLevel}>{o.riskLevel}</span></td>
                    <td><Link className="abtn sm" href={tk("/admin/orders/" + o.id)}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
