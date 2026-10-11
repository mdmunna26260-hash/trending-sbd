import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bridgeAuthorized } from "@/lib/wa";
export const dynamic = "force-dynamic";

/* Delivery / read receipts from the bridge (Baileys `messages.update`).
   The bridge is the only caller (x-bridge-key), and the row it updates is the one we sent:
   matched by the WhatsApp message id we stored when the send succeeded. */
export async function POST(req: Request) {
  if (!(await bridgeAuthorized(req))) {
    return NextResponse.json({ error: "bad bridge key" }, { status: 401 });
  }
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const b = await req.json().catch(() => ({} as any));
  const id = String(b.id || "").trim();
  const status = String(b.status || "").toUpperCase();
  if (!id || !["DELIVERED", "READ", "FAILED"].includes(status)) {
    return NextResponse.json({ error: "id and status (DELIVERED|READ|FAILED) required" }, { status: 400 });
  }

  const row = await db.waMessage.findFirst({ where: { bridgeId: id }, select: { id: true, status: true } });
  if (!row) return NextResponse.json({ ok: true, matched: false });

  const now = new Date();
  const data: any = {};
  if (status === "DELIVERED" && !["READ"].includes(row.status)) { data.status = "DELIVERED"; data.deliveredAt = now; }
  if (status === "READ") { data.status = "READ"; data.deliveredAt = now; data.readAt = now; }
  if (status === "FAILED") { data.status = "FAILED"; data.error = String(b.error || "failed after send").slice(0, 200); }
  await db.waMessage.update({ where: { id: row.id }, data });
  return NextResponse.json({ ok: true, matched: true, id: row.id, status: data.status });
}
