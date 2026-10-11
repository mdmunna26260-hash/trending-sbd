import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bridgeAuthorized } from "@/lib/wa";
import { logApp } from "@/lib/logs";
export const dynamic = "force-dynamic";

const STATUSES = ["CONNECTED", "DISCONNECTED", "QR", "PAUSED", "BANNED"];

/* Device state pushed by the bridge (connected / QR waiting / logged out / banned).
   The admin Devices screen also polls, but this is what makes the panel update the moment a
   number drops — and what raises the alert when WhatsApp removes a session. */
export async function POST(req: Request) {
  if (!(await bridgeAuthorized(req))) {
    return NextResponse.json({ error: "bad bridge key" }, { status: 401 });
  }
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const b = await req.json().catch(() => ({} as any));
  const sessionId = String(b.sessionId || "").trim();
  const status = String(b.status || "").toUpperCase();
  if (!sessionId || !STATUSES.includes(status)) {
    return NextResponse.json({ error: "sessionId and a valid status required" }, { status: 400 });
  }

  const phone = String(b.phone || b.me || "").replace(/\D/g, "").replace(/:\d+$/, "") || null;
  const existing = await db.waDevice.findUnique({ where: { sessionId } });
  if (!existing) {
    await db.waDevice.create({
      data: { name: String(b.name || sessionId).slice(0, 60), sessionId, status, phone, lastSeenAt: status === "CONNECTED" ? new Date() : null, lastError: b.error ? String(b.error).slice(0, 300) : null },
    }).catch(() => {});
    await logApp("INFO", "WHATSAPP", `bridge registered device ${sessionId} (${status})`).catch(() => {});
    return NextResponse.json({ ok: true, created: true });
  }

  // an owner-paused (or banned) number is not silently un-paused by a status push
  const keepStatus = ["PAUSED", "BANNED"].includes(existing.status) && status === "CONNECTED";
  const data: any = {
    phone: phone || existing.phone,
    lastError: b.error ? String(b.error).slice(0, 300) : status === "CONNECTED" ? null : existing.lastError,
  };
  if (!keepStatus) data.status = status;
  if (status === "CONNECTED") { data.lastSeenAt = new Date(); data.consecutiveFailures = 0; }
  await db.waDevice.update({ where: { id: existing.id }, data });

  if (existing.status !== status) {
    const key = "whatsapp.lastDeviceState." + sessionId;
    await db.setting.upsert({ where: { key }, update: { value: JSON.stringify(status) }, create: { key, value: JSON.stringify(status) } }).catch(() => {});
    await logApp(status === "CONNECTED" ? "INFO" : "WARN", "WHATSAPP", `${existing.name} → ${status}${b.error ? ` (${String(b.error).slice(0, 120)})` : ""}`, { sessionId }).catch(() => {});
    if (["DISCONNECTED", "BANNED"].includes(status)) {
      const { notifyAdmin } = await import("@/lib/notify");
      notifyAdmin("inbox", `⚠ WhatsApp device ${existing.name} → ${status}`, `${phone || existing.phone || "no number"}${b.error ? " · " + String(b.error).slice(0, 140) : ""}`, existing.name).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, status: data.status || existing.status });
}
