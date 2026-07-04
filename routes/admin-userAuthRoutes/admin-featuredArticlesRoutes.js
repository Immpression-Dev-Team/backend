import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import FeaturedArticle from "../../models/featuredArticle.js";

const router = express.Router();

// GET /api/admin/articles — list all
router.get("/", isAdminAuthorized, async (_req, res) => {
  try {
    const articles = await FeaturedArticle.find().sort({ order: 1, publishedAt: -1 });
    res.json({ success: true, data: articles });
  } catch (e) {
    console.error("GET /api/admin/articles error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch articles" });
  }
});

// POST /api/admin/articles — create
router.post("/", isAdminAuthorized, async (req, res) => {
  const { title, url, imageUrl, publication, publishedAt, order } = req.body;
  if (!title || !url || !imageUrl || !publishedAt) {
    return res.status(400).json({ success: false, error: "title, url, imageUrl, and publishedAt are required" });
  }
  try {
    const article = await FeaturedArticle.create({ title, url, imageUrl, publication, publishedAt, order: order || 0 });
    res.status(201).json({ success: true, data: article });
  } catch (e) {
    console.error("POST /api/admin/articles error:", e);
    res.status(500).json({ success: false, error: "Failed to create article" });
  }
});

// PUT /api/admin/articles/:id — update
router.put("/:id", isAdminAuthorized, async (req, res) => {
  const { title, url, imageUrl, publication, publishedAt, order } = req.body;
  try {
    const article = await FeaturedArticle.findByIdAndUpdate(
      req.params.id,
      { title, url, imageUrl, publication, publishedAt, order },
      { new: true, runValidators: true }
    );
    if (!article) return res.status(404).json({ success: false, error: "Article not found" });
    res.json({ success: true, data: article });
  } catch (e) {
    console.error("PUT /api/admin/articles/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to update article" });
  }
});

// DELETE /api/admin/articles/:id
router.delete("/:id", isAdminAuthorized, async (req, res) => {
  try {
    const article = await FeaturedArticle.findByIdAndDelete(req.params.id);
    if (!article) return res.status(404).json({ success: false, error: "Article not found" });
    res.json({ success: true, message: "Article deleted" });
  } catch (e) {
    console.error("DELETE /api/admin/articles/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to delete article" });
  }
});

export default router;
