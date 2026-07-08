import express from "express";
import BlogPost from "../../models/blogPost.js";

const router = express.Router();

// GET /api/blog — all published posts
router.get("/", async (_req, res) => {
  try {
    const posts = await BlogPost.find({ published: true }).sort({ publishedAt: -1 });
    res.json({ success: true, data: posts });
  } catch (e) {
    console.error("GET /api/blog error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch posts" });
  }
});

// GET /api/blog/:slug — single published post
router.get("/:slug", async (req, res) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, published: true });
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.json({ success: true, data: post });
  } catch (e) {
    console.error("GET /api/blog/:slug error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch post" });
  }
});

export default router;
