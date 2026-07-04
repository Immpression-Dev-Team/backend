import express from "express";
import FeaturedArticle from "../../models/featuredArticle.js";

const router = express.Router();

// GET /api/articles — public, returns all articles sorted by order then date
router.get("/", async (_req, res) => {
  try {
    const articles = await FeaturedArticle.find().sort({ order: 1, publishedAt: -1 });
    res.json({ success: true, data: articles });
  } catch (e) {
    console.error("GET /api/articles error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch articles" });
  }
});

export default router;
