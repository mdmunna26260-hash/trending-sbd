import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer } from "@/components/chrome";
import { imgSrc, imgSrcSet } from "@/components/img-src";
import { blocks, readingMinutes, dateLabel } from "@/lib/blog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Journal",
  description:
    "Buying guides, sizing help and care tips from TRENDING'S — the questions customers ask us on WhatsApp, written down properly before you order.",
  alternates: { canonical: "/blog" },
};

/* Card image helper: the same variant rules the product grid uses, so a 300px card never
   downloads a 1200px file. */
const thumb = (url: string | null, widths: number[]) => ({
  src: imgSrc(url, widths[widths.length - 1]),
  srcSet: imgSrcSet(url, widths),
  sizes: "(max-width: 700px) 92vw, (max-width: 1100px) 46vw, 330px",
});

/* The public blog index. Only published posts appear. */
export default async function BlogIndex() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const store: any = cfg.store || {};
  const cats = await getCategories();
  const posts = await db.blogPost.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, slug: true, excerpt: true, content: true, image: true, createdAt: true },
  });

  const [lead, ...rest] = posts;

  return (
    <>
      <Header storeName={store.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <main className="container blog-wrap">
        <div className="blog-head">
          <div className="eyebrow">Journal</div>
          <h1>Guides, sizing &amp; care</h1>
          <p className="blog-lede">
            What to check before you order, how the sizes actually run, and how to keep a piece looking new —
            the questions we answer on WhatsApp every day, written down properly.
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="blog-empty">
            <p>Nothing published yet — the first guide is being written.</p>
            <Link className="btn btn-accent" href="/products">Browse the collection</Link>
          </div>
        ) : (
          <>
            <Link className="blog-lead" href={`/blog/${lead.slug}`}>
              {lead.image && (
                <div className="blog-lead-img">
                  <img {...thumb(lead.image, [400, 600, 800])} sizes="(max-width: 900px) 92vw, 560px" alt={lead.title} />
                </div>
              )}
              <div className="blog-lead-body">
                <div className="blog-meta">
                  {dateLabel(lead.createdAt)} · {readingMinutes(lead.content)} min read
                </div>
                <h2>{lead.title}</h2>
                <p>{lead.excerpt || blocks(lead.content)[0]?.text || ""}</p>
                <span className="blog-more">Read the guide →</span>
              </div>
            </Link>

            {rest.length > 0 && (
              <div className="blog-grid">
                {rest.map((p) => (
                  <Link className="blog-card" key={p.id} href={`/blog/${p.slug}`}>
                    {p.image && (
                      <div className="blog-card-img">
                        <img {...thumb(p.image, [200, 300, 400, 600])} alt={p.title} loading="lazy" />
                      </div>
                    )}
                    <div className="blog-meta">{dateLabel(p.createdAt)} · {readingMinutes(p.content)} min</div>
                    <h3>{p.title}</h3>
                    <p>{p.excerpt || blocks(p.content)[0]?.text || ""}</p>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
