import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import { requireRole } from "../../utils/adminAuthorization.js";
import { FULL_ACCESS_ROLES } from "../../constants/adminRoles.js";
import Referral from "../../models/referral.js";
import ReferralEvent, { REFERRAL_EVENT_TYPE, REFERRAL_ROLE } from "../../models/referralEvent.js";
import { generateUniqueReferralCode } from "../../utils/referralCode.js";

const router = express.Router();

// Referrals are only accessible to full-access admins (Content Editor is excluded).
router.use(isAdminAuthorized, requireRole(FULL_ACCESS_ROLES));

const APP_BASE_URL = process.env.APP_BASE_URL || "https://immpression.art";

function toPublic(referral) {
  return {
    _id: referral._id,
    name: referral.name,
    internalLabel: referral.internalLabel,
    code: referral.code,
    previousCodes: referral.previousCodes,
    publicUrl: `${APP_BASE_URL}/invite/${referral.code}`,
    createdAt: referral.createdAt,
    updatedAt: referral.updatedAt,
  };
}

function emptyStats() {
  return {
    pageViews: 0,
    artistSelections: 0,
    artLoverSelections: 0,
    bothSelections: 0,
    totalRoleSelections: 0,
    appStoreClicks: 0,
    playStoreClicks: 0,
    totalStoreClicks: 0,
    visitToRoleConversion: 0,
    visitToStoreConversion: 0,
    lastActivity: null,
  };
}

// Aggregates ReferralEvent rows into per-referral funnel stats in a single query
// (avoids N+1 queries against the events collection).
async function statsByReferralId(referralIds) {
  const statsMap = {};
  for (const id of referralIds) statsMap[id.toString()] = emptyStats();
  if (referralIds.length === 0) return statsMap;

  const rows = await ReferralEvent.aggregate([
    { $match: { referral: { $in: referralIds } } },
    {
      $group: {
        _id: { referral: "$referral", type: "$type", role: "$role" },
        count: { $sum: 1 },
        lastAt: { $max: "$createdAt" },
      },
    },
  ]);

  for (const row of rows) {
    const key = row._id.referral.toString();
    const stats = statsMap[key];
    if (!stats) continue;

    if (!stats.lastActivity || row.lastAt > stats.lastActivity) stats.lastActivity = row.lastAt;

    switch (row._id.type) {
      case REFERRAL_EVENT_TYPE.PAGE_VIEW:
        stats.pageViews += row.count;
        break;
      case REFERRAL_EVENT_TYPE.ROLE_SELECTED:
        stats.totalRoleSelections += row.count;
        if (row._id.role === REFERRAL_ROLE.ARTIST) stats.artistSelections += row.count;
        if (row._id.role === REFERRAL_ROLE.ART_LOVER) stats.artLoverSelections += row.count;
        if (row._id.role === REFERRAL_ROLE.BOTH) stats.bothSelections += row.count;
        break;
      case REFERRAL_EVENT_TYPE.APP_STORE_CLICK:
        stats.appStoreClicks += row.count;
        stats.totalStoreClicks += row.count;
        break;
      case REFERRAL_EVENT_TYPE.PLAY_STORE_CLICK:
        stats.playStoreClicks += row.count;
        stats.totalStoreClicks += row.count;
        break;
    }
  }

  for (const stats of Object.values(statsMap)) {
    if (stats.pageViews > 0) {
      stats.visitToRoleConversion = (stats.totalRoleSelections / stats.pageViews) * 100;
      stats.visitToStoreConversion = (stats.totalStoreClicks / stats.pageViews) * 100;
    }
  }

  return statsMap;
}

// GET /api/admin/referrals — list all, with funnel stats from real persisted events
router.get("/", async (_req, res) => {
  try {
    const referrals = await Referral.find().sort({ createdAt: -1 });
    const statsMap = await statsByReferralId(referrals.map((r) => r._id));

    const data = referrals.map((r) => ({
      ...toPublic(r),
      stats: statsMap[r._id.toString()],
    }));

    res.json({ success: true, data });
  } catch (e) {
    console.error("GET /api/admin/referrals error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch referrals" });
  }
});

// GET /api/admin/referrals/:id/stats — aggregated funnel stats + recent events for one referral
router.get("/:id/stats", async (req, res) => {
  try {
    const referral = await Referral.findById(req.params.id);
    if (!referral) return res.status(404).json({ success: false, error: "Referral not found" });

    const statsMap = await statsByReferralId([referral._id]);
    const recentEvents = await ReferralEvent.find({ referral: referral._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("type role platform createdAt");

    res.json({
      success: true,
      data: {
        referral: toPublic(referral),
        stats: statsMap[referral._id.toString()],
        recentEvents,
      },
    });
  } catch (e) {
    console.error("GET /api/admin/referrals/:id/stats error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch referral stats" });
  }
});

// POST /api/admin/referrals — create (code is always server-generated)
router.post("/", async (req, res) => {
  const { name, internalLabel } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: "name is required" });
  }
  try {
    const code = await generateUniqueReferralCode();
    const referral = await Referral.create({
      name: name.trim(),
      internalLabel: (internalLabel || "").trim(),
      code,
      createdBy: req.admin._id,
    });
    res.status(201).json({ success: true, data: toPublic(referral) });
  } catch (e) {
    console.error("POST /api/admin/referrals error:", e);
    res.status(500).json({ success: false, error: "Failed to create referral" });
  }
});

// PUT /api/admin/referrals/:id — update name/internalLabel only; code changes go through /regenerate
router.put("/:id", async (req, res) => {
  const { name, internalLabel } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: "name is required" });
  }
  try {
    const referral = await Referral.findByIdAndUpdate(
      req.params.id,
      { name: name.trim(), internalLabel: (internalLabel || "").trim() },
      { new: true, runValidators: true }
    );
    if (!referral) return res.status(404).json({ success: false, error: "Referral not found" });
    res.json({ success: true, data: toPublic(referral) });
  } catch (e) {
    console.error("PUT /api/admin/referrals/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to update referral" });
  }
});

// POST /api/admin/referrals/:id/regenerate — issue a new code, retire the old one for safe redirects
router.post("/:id/regenerate", async (req, res) => {
  try {
    const referral = await Referral.findById(req.params.id);
    if (!referral) return res.status(404).json({ success: false, error: "Referral not found" });

    const newCode = await generateUniqueReferralCode();
    referral.previousCodes.push(referral.code);
    referral.code = newCode;
    await referral.save();

    res.json({ success: true, data: toPublic(referral) });
  } catch (e) {
    console.error("POST /api/admin/referrals/:id/regenerate error:", e);
    res.status(500).json({ success: false, error: "Failed to regenerate code" });
  }
});

// DELETE /api/admin/referrals/:id
router.delete("/:id", async (req, res) => {
  try {
    const referral = await Referral.findByIdAndDelete(req.params.id);
    if (!referral) return res.status(404).json({ success: false, error: "Referral not found" });
    await ReferralEvent.deleteMany({ referral: referral._id });
    res.json({ success: true, message: "Referral deleted" });
  } catch (e) {
    console.error("DELETE /api/admin/referrals/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to delete referral" });
  }
});

export default router;
