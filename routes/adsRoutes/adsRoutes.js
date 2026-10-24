// routes/adsRoutes/adsRoutes.js
// Public, read-only ad config for the website: which placements admins have
// switched on (network master switch + placement switch). The ad code itself
// lives in the web-app.

import express from "express";
import AdminSettings from "../../models/adminSettings.js";

const router = express.Router();

// Placement ids per network — keep in sync with models/adminSettings.js.
export const AD_PLACEMENTS = {
  adsterra: ["marketplaceRailTop"],
  hilltop: ["marketplaceRailSecond"],
};

/**
 * GET /api/ads/config
 * → { success, data: { adsterra: { marketplaceRailTop: true } } }
 */
router.get("/config", async (_req, res) => {
  try {
    const settings = await AdminSettings.findOne({ _singleton: true }).lean();
    const data = {};

    for (const [network, placementIds] of Object.entries(AD_PLACEMENTS)) {
      const cfg = settings?.ads?.[network];
      if (!cfg?.enabled) continue;
      for (const id of placementIds) {
        const p = cfg.placements?.[id];
        if (p?.enabled) {
          data[network] = data[network] || {};
          data[network][id] = true;
        }
      }
    }

    // Short cache so admin toggles show up on the site within a minute.
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    res.json({ success: true, data });
  } catch (e) {
    console.error("GET /api/ads/config error:", e.message);
    res.status(500).json({ success: false, error: "Failed to load ad config" });
  }
});

export default router;
