import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
  const b = await req.json();
  // Partial update: only touch fields the client actually sent, so an
  // image-only upload can't wipe description/sizeChart (or name).
  const data: any = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.description !== undefined) data.description = b.description || null;
  if (b.image !== undefined) data.image = b.image || null;
  if (b.sizeChart !== undefined) data.sizeChart = b.sizeChart || null;
  if (b.slug) data.slug = slugify(b.slug);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  try {
    const c = await db.category.update({ where: { id }, data });
    return NextResponse.json({ ok: true, category: c });
  } catch {
    return NextResponse.json({ error: "Update failed (slug may already be in use)" }, { status: 400 });
  }
}
export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
  // Still swallowed for a *valid* id that no longer exists: the admin UI treats a
  // repeat delete as success. A malformed id is now rejected above instead of being
  // silently reported as a successful deletion.
  await db.category.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
