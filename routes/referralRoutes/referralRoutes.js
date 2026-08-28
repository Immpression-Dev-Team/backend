import express from "express";
import Referral from "../../models/referral.js";
import ReferralEvent, { REFERRAL_EVENT_TYPE, REFERRAL_ROLE } from "../../models/referralEvent.js";

const router = express.Router();

const EVENT_TYPES = Object.values(REFERRAL_EVENT_TYPE);
const ROLES = Object.values(REFERRAL_ROLE);

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

// POST /api/invite/:code/event — public. Records a funnel event (page view,
// role selection, store click) for the referral behind this code. Response
// never contains anything about the referral beyond success/failure.
router.post("/:code/event", async (req, res) => {
  try {
    const { code } = req.params;
    const { type, role, platform } = req.body;

    if (!EVENT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: "Invalid event type" });
    }
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: "Invalid role" });
    }

    const referral =
      (await Referral.findOne({ code }).select("_id")) ||
      (await Referral.findOne({ previousCodes: code }).select("_id"));

    if (!referral) {
      return res.status(404).json({ success: false, error: "Invite not found" });
    }

    await ReferralEvent.create({
      referral: referral._id,
      type,
      role: role || undefined,
      platform: typeof platform === "string" ? platform.slice(0, 32) : undefined,
    });

    res.status(201).json({ success: true });
  } catch (e) {
    console.error("POST /api/invite/:code/event error:", e);
    res.status(500).json({ success: false, error: "Failed to record event" });
  }
});

export default router;
