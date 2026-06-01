import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import { getFeaturedArtworks, saveFeaturedArtworks, getPublicArtwork, searchPublicArt, VALID_SOURCES } from "../../services/publicArt.js";

const router = express.Router();

// GET /api/admin/public-art/featured
// Returns the current curated list with full artwork data.
router.get("/featured", isAdminAuthorized, async (_req, res) => {
  try {
    const artworks = await getFeaturedArtworks();
    res.json({ success: true, data: artworks });
  } catch (e) {
    console.error("GET /api/admin/public-art/featured error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch featured artworks" });
  }
});

// PUT /api/admin/public-art/featured
// Body: { artworks: [{ source: "met"|"chicago", id: string }] }  (max 20)
router.put("/featured", isAdminAuthorized, async (req, res) => {
  const { artworks } = req.body;

  if (!Array.isArray(artworks)) {
    return res.status(400).json({ success: false, error: "artworks must be an array" });
  }
  if (artworks.length > 20) {
    return res.status(400).json({ success: false, error: "Cannot feature more than 20 artworks" });
  }

  for (const item of artworks) {
    if (!VALID_SOURCES.includes(item.source) || !item.id) {
      return res.status(400).json({ success: false, error: "Each artwork must have a valid source and id" });
    }
  }

  try {
    const adminEmail = req.admin?.email || "unknown";
    // artworks are full objects from the admin panel — store directly, no re-fetching needed
    await saveFeaturedArtworks(artworks, adminEmail);
    res.json({ success: true, message: `Saved ${artworks.length} featured artworks` });
  } catch (e) {
    console.error("PUT /api/admin/public-art/featured error:", e);
    res.status(500).json({ success: false, error: "Failed to save featured artworks" });
  }
});

// GET /api/admin/public-art/search?q=monet&source=all&limit=20
router.get("/search", isAdminAuthorized, async (req, res) => {
  const { q, source = "all", limit } = req.query;
  if (!q?.trim()) {
    return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
  }
  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 40);
  try {
    const results = await searchPublicArt(q.trim(), source, limitNum);
    res.json({ success: true, data: results, count: results.length });
  } catch (e) {
    console.error("GET /api/admin/public-art/search error:", e);
    res.status(500).json({ success: false, error: "Failed to search artworks" });
  }
});

// GET /api/admin/public-art/:source/:id  — preview a single artwork
router.get("/:source/:id", isAdminAuthorized, async (req, res) => {
  const { source, id } = req.params;
  try {
    const artwork = await getPublicArtwork(source, id);
    if (!artwork) return res.status(404).json({ success: false, error: "Artwork not found" });
    res.json({ success: true, data: artwork });
  } catch (e) {
    res.status(500).json({ success: false, error: "Failed to fetch artwork" });
  }
});

export default router;
