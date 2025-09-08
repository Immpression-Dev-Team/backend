// routes/notificationRoutes/notificationRoutes.js
import express from "express";
import mongoose from "mongoose";
import Notification from "../../models/notifications.js";
import { isUserAuthorized } from "../../utils/authUtils.js";

const router = express.Router();

/**
 * GET /notifications?limit=20&after=ISO_DATE
 * Cursor-paginated by createdAt DESC. Returns nextCursor for subsequent calls.
 */
router.get("/", isUserAuthorized, async (req, res) => {
  try {
    const { limit = 20, after } = req.query;

    // sanitize & cap
    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

    const query = { recipientUserId: req.user._id };
    if (after) {
      const d = new Date(after);
      if (!Number.isNaN(d.getTime())) {
        query.createdAt = { $lt: d };
      }
    }

    const items = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .populate({ path: 'actorUserId', select: 'name' })
      .populate({ path: 'recipientUserId', select: 'name' })
      .lean();

    const nextCursor = items.length ? items[items.length - 1].createdAt : null;

    res.json({ success: true, data: items, nextCursor });
  } catch (e) {
    console.error("GET /notifications error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * GET /notifications/unread-count
 */
router.get("/unread-count", isUserAuthorized, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipientUserId: req.user._id,
      readAt: null,
    });
    res.json({ success: true, data: { count } });
  } catch (e) {
    console.error("GET /notifications/unread-count error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * PATCH /notifications/:id/read
 * Marks a single notification as read if it belongs to the user.
 */
router.patch("/:id/read", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid id" });
    }

    const result = await Notification.updateOne(
      { _id: id, recipientUserId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.error("PATCH /notifications/:id/read error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * PATCH /notifications/read-all
 * Marks all unread notifications for the user as read.
 */
router.patch("/read-all", isUserAuthorized, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipientUserId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.error("PATCH /notifications/read-all error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
