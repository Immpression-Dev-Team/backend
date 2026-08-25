import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import { requireRole } from "../../utils/adminAuthorization.js";
import { FULL_ACCESS_ROLES } from "../../constants/adminRoles.js";
import AdminSettings from "../../models/adminSettings.js";
import UserModel from "../../models/users.js";
import ImageModel from "../../models/images.js";
import OrderModel from "../../models/orders.js";

const router = express.Router();

// Settings are only accessible to full-access admins (Content Editor is excluded).
router.use(isAdminAuthorized, requireRole(FULL_ACCESS_ROLES));

// ─── Helper: get or create the singleton settings doc ───────────────────────
async function getOrCreateSettings() {
  let doc = await AdminSettings.findOne({ _singleton: true });
  if (!doc) {
    doc = await AdminSettings.create({ _singleton: true });
  }
  return doc;
}

// ─── GET /api/admin/settings ─────────────────────────────────────────────────
router.get("/", isAdminAuthorized, async (_req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ success: true, data: settings });
  } catch (e) {
    console.error("GET /admin/settings error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ─── PUT /api/admin/settings ─────────────────────────────────────────────────
router.put("/", isAdminAuthorized, async (req, res) => {
  try {
    const { notifications, notificationEmails } = req.body;

    const settings = await getOrCreateSettings();

    if (notifications) {
      if (typeof notifications.newSignup === "boolean")
        settings.notifications.newSignup = notifications.newSignup;
      if (typeof notifications.newPendingArtwork === "boolean")
        settings.notifications.newPendingArtwork = notifications.newPendingArtwork;
      if (typeof notifications.newReport === "boolean")
        settings.notifications.newReport = notifications.newReport;
    }

    if (Array.isArray(notificationEmails)) {
      // sanitise — remove blanks
      settings.notificationEmails = notificationEmails
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    }

    await settings.save();
    res.json({ success: true, data: settings });
  } catch (e) {
    console.error("PUT /admin/settings error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ─── CSV helper ──────────────────────────────────────────────────────────────
function toCSV(headers, rows) {
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

// ─── GET /api/admin/export/users ─────────────────────────────────────────────
router.get("/export/users", isAdminAuthorized, async (_req, res) => {
  try {
    const users = await UserModel.find({}, "-password").lean();

    const headers = ["_id", "name", "email", "accountType", "artistType", "isVerified", "stripeAccountId", "stripeOnboardingCompleted", "createdAt"];
    const csv = toCSV(
      headers,
      users.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        accountType: u.accountType,
        artistType: u.artistType || "",
        isVerified: u.isVerified ? "Yes" : "No",
        stripeAccountId: u.stripeAccountId || "",
        stripeOnboardingCompleted: u.stripeOnboardingCompleted ? "Yes" : "No",
        createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : "",
      }))
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="immpression_users_${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error("Export users error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ─── GET /api/admin/export/artworks ──────────────────────────────────────────
router.get("/export/artworks", isAdminAuthorized, async (_req, res) => {
  try {
    const artworks = await ImageModel.find({}).lean();

    const headers = ["_id", "name", "artistName", "category", "price", "stage", "views", "soldStatus", "isSigned", "isFramed", "weight", "createdAt"];
    const csv = toCSV(
      headers,
      artworks.map((a) => ({
        _id: a._id,
        name: a.name,
        artistName: a.artistName,
        category: a.category,
        price: a.price,
        stage: a.stage || "review",
        views: a.views || 0,
        soldStatus: a.soldStatus || "unsold",
        isSigned: a.isSigned ? "Yes" : "No",
        isFramed: a.isFramed ? "Yes" : "No",
        weight: a.weight || "",
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : "",
      }))
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="immpression_artworks_${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error("Export artworks error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ─── GET /api/admin/export/orders ────────────────────────────────────────────
router.get("/export/orders", isAdminAuthorized, async (_req, res) => {
  try {
    const orders = await OrderModel.find({}).lean();

    const headers = ["_id", "artName", "artistName", "status", "totalAmount", "buyerEmail", "createdAt"];
    const csv = toCSV(
      headers,
      orders.map((o) => ({
        _id: o._id,
        artName: o.artName || "",
        artistName: o.artistName || "",
        status: o.status || "",
        totalAmount: o.totalAmount ? (o.totalAmount / 100).toFixed(2) : "0.00",
        buyerEmail: o.buyerEmail || o.customerEmail || "",
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : "",
      }))
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="immpression_orders_${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error("Export orders error:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
