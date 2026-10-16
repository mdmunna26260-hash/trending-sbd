import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ posts: await db.blogPost.findMany({ orderBy: { createdAt: "desc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.title || !b.content) return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  for (const f of ["title", "slug", "excerpt", "content", "image"] as const) {
    if (b[f] != null && typeof b[f] !== "string") {
      return NextResponse.json({ error: `${f} must be a string` }, { status: 400 });
    }
  }
  const post = await db.blogPost.create({ data: { title: String(b.title), slug: slugify(b.slug || b.title), excerpt: b.excerpt || null, content: b.content, image: b.image || null, published: !!b.published } });
  return NextResponse.json({ ok: true, post });
}
