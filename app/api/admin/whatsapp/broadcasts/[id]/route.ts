import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { db } from "@/lib/db";
import { broadcastReport, broadcastCsv } from "@/lib/wa-broadcast";

export const dynamic = "force-dynamic";

/* One campaign's report (Phase 3).
   GET ?format=csv → the same numbers as a CSV download (recipient rows included).
   GET (default)   → progress, per-status counts, delivery/read %, failures, link clicks,
                     attributed orders and the frozen audience. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid broadcast ID" }, { status: 400 });
  const report = await broadcastReport(id);
  if (!report) return NextResponse.json({ error: "Campaign ta nei" }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    const rows = await db.waMessage.findMany({ where: { broadcastId: id }, orderBy: { id: "asc" }, take: 20000 });
    const csv = broadcastCsv({ ...report, rows });
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="wa-campaign-${id}.csv"`,
      },
    });
  }

  const messages = await db.waMessage.findMany({
    where: { broadcastId: id },
    orderBy: { id: "desc" },
    take: 100,
    select: { id: true, toWaId: true, status: true, error: true, attempts: true, mediaJson: true, queuedAt: true, sentAt: true, deliveredAt: true, readAt: true, couponCode: true },
  });
  return NextResponse.json({ ok: true, ...report, messages });
}
