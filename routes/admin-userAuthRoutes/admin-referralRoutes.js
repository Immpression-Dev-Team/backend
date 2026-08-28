import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import { requireRole } from "../../utils/adminAuthorization.js";
import { FULL_ACCESS_ROLES } from "../../constants/adminRoles.js";
import Referral from "../../models/referral.js";
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

// GET /api/admin/referrals — list all
router.get("/", async (_req, res) => {
  try {
    const referrals = await Referral.find().sort({ createdAt: -1 });
    res.json({ success: true, data: referrals.map(toPublic) });
  } catch (e) {
    console.error("GET /api/admin/referrals error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch referrals" });
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
    res.json({ success: true, message: "Referral deleted" });
  } catch (e) {
    console.error("DELETE /api/admin/referrals/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to delete referral" });
  }
});

export default router;
