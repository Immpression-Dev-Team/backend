import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import BlogPost from "../../models/blogPost.js";

const router = express.Router();

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function uniqueSlug(base, excludeId = null) {
  let slug = slugify(base);
  let count = 0;
  while (true) {
    const existing = await BlogPost.findOne({ slug });
    if (!existing || (excludeId && String(existing._id) === String(excludeId))) break;
    count++;
    slug = `${slugify(base)}-${count}`;
  }
  return slug;
}

// GET /api/admin/blog
router.get("/", isAdminAuthorized, async (_req, res) => {
  try {
    const posts = await BlogPost.find().sort({ createdAt: -1 });
    res.json({ success: true, data: posts });
  } catch (e) {
    console.error("GET /api/admin/blog error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch posts" });
  }
});

// POST /api/admin/blog
router.post("/", isAdminAuthorized, async (req, res) => {
  const { title, body, coverImageUrl, published } = req.body;
  if (!title || !body || !coverImageUrl) {
    return res.status(400).json({ success: false, error: "title, body, and coverImageUrl are required" });
  }
  try {
    const slug = await uniqueSlug(title);
    const post = await BlogPost.create({
      title,
      slug,
      body,
      coverImageUrl,
      published: !!published,
      publishedAt: published ? new Date() : undefined,
    });
    res.status(201).json({ success: true, data: post });
  } catch (e) {
    console.error("POST /api/admin/blog error:", e);
    res.status(500).json({ success: false, error: "Failed to create post" });
  }
});

// PUT /api/admin/blog/:id
router.put("/:id", isAdminAuthorized, async (req, res) => {
  const { title, body, coverImageUrl, published } = req.body;
  try {
    const existing = await BlogPost.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: "Post not found" });

    const update = { body, coverImageUrl, published: !!published };
    if (title && title !== existing.title) {
      update.title = title;
      update.slug = await uniqueSlug(title, req.params.id);
    }
    if (published && !existing.publishedAt) {
      update.publishedAt = new Date();
    }

    const post = await BlogPost.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    res.json({ success: true, data: post });
  } catch (e) {
    console.error("PUT /api/admin/blog/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to update post" });
  }
});

// DELETE /api/admin/blog/:id
router.delete("/:id", isAdminAuthorized, async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.json({ success: true, message: "Post deleted" });
  } catch (e) {
    console.error("DELETE /api/admin/blog/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to delete post" });
  }
});

export default router;
