// routes/publicArtRoutes/publicArtRoutes.js
// Public domain art proxy routes — no MongoDB interaction.

import express from "express";
import {
  searchPublicArt,
  getPublicArtwork,
  getFeaturedArtworks,
} from "../../services/publicArt.js";

const router = express.Router();

/**
 * GET /public-art/featured
 * Returns a curated list of well-known public domain works.
 */
router.get("/featured", async (_req, res) => {
  try {
    const artworks = await getFeaturedArtworks();
    res.json({ success: true, data: artworks });
  } catch (e) {
    console.error("GET /public-art/featured error:", e.message);
    res.status(500).json({ success: false, error: "Failed to fetch featured artworks" });
  }
});

/**
 * GET /public-art/search?q=monet&source=met&limit=20
 * Search public domain artworks by keyword.
 * source: "met" | "chicago" | "all" (default: "all")
 * limit:  per-source result count, max 40 (default: 20)
 */
router.get("/search", async (req, res) => {
  const { q, source = "all", limit } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
  }

  const validSources = ["met", "chicago", "all"];
  if (!validSources.includes(source)) {
    return res.status(400).json({
      success: false,
      error: `Invalid source. Must be one of: ${validSources.join(", ")}`,
    });
  }

  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 40);

  try {
    const results = await searchPublicArt(q.trim(), source, limitNum);
    res.json({ success: true, data: results, count: results.length });
  } catch (e) {
    console.error("GET /public-art/search error:", e.message);
    res.status(500).json({ success: false, error: "Failed to search artworks" });
  }
});

/**
 * GET /public-art/:source/:id
 * Fetch a single artwork by source and ID.
 * source: "met" | "chicago"
 */
router.get("/:source/:id", async (req, res) => {
  const { source, id } = req.params;

  const validSources = ["met", "chicago"];
  if (!validSources.includes(source)) {
    return res.status(400).json({
      success: false,
      error: `Invalid source. Must be one of: ${validSources.join(", ")}`,
    });
  }

  try {
    const artwork = await getPublicArtwork(source, id);
    if (!artwork) {
      return res.status(404).json({ success: false, error: "Artwork not found" });
    }
    res.json({ success: true, data: artwork });
  } catch (e) {
    console.error(`GET /public-art/${source}/${id} error:`, e.message);
    res.status(500).json({ success: false, error: "Failed to fetch artwork" });
  }
});

export default router;
