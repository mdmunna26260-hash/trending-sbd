import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { logAudit } from "@/lib/auth";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/* Blog post edit / publish / delete. The list + create endpoint lives in ../route.ts; these are
   the two operations a writer needs after the first save: fix a typo, and take it live. */
export async function GET(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid post ID" }, { status: 400 });
  const post = await db.blogPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    const id = parseIdParam(params.id);
    if (id === null) return NextResponse.json({ error: "Invalid post ID" }, { status: 400 });
    const before = await db.blogPost.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data: any = {};
    if (b.title !== undefined) data.title = String(b.title).trim();
    if (b.excerpt !== undefined) data.excerpt = b.excerpt ? String(b.excerpt).slice(0, 300) : null;
    if (b.content !== undefined) data.content = String(b.content);
    if (b.image !== undefined) data.image = b.image || null;
    if (b.published !== undefined) data.published = !!b.published;
    if (b.slug !== undefined || b.title !== undefined) {
      const want = slugify(b.slug || data.title || before.title);
      if (want && want !== before.slug) {
        // a live URL that 404s is worse than a slightly ugly slug, so never collide
        const clash = await db.blogPost.findFirst({ where: { slug: want, id: { not: id } } });
        data.slug = clash ? want + "-" + Date.now().toString(36) : want;
      }
    }
    if (data.title === "") return NextResponse.json({ error: "Title required" }, { status: 400 });
    if (data.content === "") return NextResponse.json({ error: "Content required" }, { status: 400 });
    const post = await db.blogPost.update({ where: { id }, data });
    if (data.published !== undefined && data.published !== before.published) {
      await logAudit(g.user.email, data.published ? "BLOG_PUBLISH" : "BLOG_UNPUBLISH", `${post.title} (/blog/${post.slug})`);
    } else {
      await logAudit(g.user.email, "BLOG_EDIT", `${post.title}${data.slug ? ` (slug → /blog/${data.slug})` : ""}`);
    }
    return NextResponse.json({ ok: true, post });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid post ID" }, { status: 400 });
  const post = await db.blogPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.blogPost.delete({ where: { id } });
  await logAudit(g.user.email, "BLOG_DELETE", post.title);
  return NextResponse.json({ ok: true });
}
