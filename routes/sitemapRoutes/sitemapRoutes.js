import express from "express";
import Image from "../../models/images.js";
import BlogPost from "../../models/blogPost.js";

const router = express.Router();

const slugify = (str = "") =>
  str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const BASE_URL = "https://www.immpression.art";

const STATIC_PAGES = [
  { loc: `${BASE_URL}/`, changefreq: "weekly", priority: "1.0" },
  { loc: `${BASE_URL}/marketplace`, changefreq: "daily", priority: "0.9" },
  { loc: `${BASE_URL}/about`, changefreq: "monthly", priority: "0.7" },
  { loc: `${BASE_URL}/contact`, changefreq: "monthly", priority: "0.6" },
  { loc: `${BASE_URL}/explore`, changefreq: "weekly", priority: "0.7" },
  { loc: `${BASE_URL}/press`, changefreq: "monthly", priority: "0.5" },
  { loc: `${BASE_URL}/blog`, changefreq: "weekly", priority: "0.6" },
];

router.get("/sitemap.xml", async (req, res) => {
  try {
    const artworks = await Image.find(
      { stage: "approved" },
      { _id: 1, name: 1, artistName: 1, updatedAt: 1 }
    ).lean();

    const artworkUrls = artworks.map((art) => {
      const artistSlug = slugify(art.artistName || "artist");
      const artworkSlug = `${slugify(art.name || "artwork")}-${art._id}`;
      const lastmod = art.updatedAt
        ? new Date(art.updatedAt).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];
      return {
        loc: `${BASE_URL}/marketplace/${artistSlug}/${artworkSlug}`,
        lastmod,
        changefreq: "weekly",
        priority: "0.8",
      };
    });

    const posts = await BlogPost.find(
      { published: true },
      { slug: 1, updatedAt: 1 }
    ).lean();

    const blogUrls = posts.map((post) => ({
      loc: `${BASE_URL}/blog/${post.slug}`,
      lastmod: post.updatedAt
        ? new Date(post.updatedAt).toISOString().split("T")[0]
        : undefined,
      changefreq: "monthly",
      priority: "0.6",
    }));

    const allUrls = [...STATIC_PAGES, ...artworkUrls, ...blogUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (err) {
    console.error("Sitemap error:", err);
    res.status(500).send("Failed to generate sitemap");
  }
});

export default router;
