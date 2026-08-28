import express from "express";
import Referral from "../../models/referral.js";

const router = express.Router();

// GET /api/invite/:code — public. Only ever selects the "code" field: the
// referrer's name/internalLabel/createdBy must never reach this response.
router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const referral = await Referral.findOne({ code }).select("code");
    if (referral) {
      return res.json({ success: true, data: { code: referral.code, redirected: false } });
    }

    const byOldCode = await Referral.findOne({ previousCodes: code }).select("code");
    if (byOldCode) {
      return res.json({ success: true, data: { code: byOldCode.code, redirected: true } });
    }

    return res.status(404).json({ success: false, error: "Invite not found" });
  } catch (e) {
    console.error("GET /api/invite/:code error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch invite" });
  }
});

export default router;
