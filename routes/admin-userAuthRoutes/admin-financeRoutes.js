import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import FinanceEntry from "../../models/financeEntry.js";

const router = express.Router();

// GET /api/admin/finance — all entries sorted by date desc
router.get("/", isAdminAuthorized, async (_req, res) => {
  try {
    const entries = await FinanceEntry.find().sort({ date: -1 });
    res.json({ success: true, data: entries });
  } catch (e) {
    console.error("GET /api/admin/finance error:", e);
    res.status(500).json({ success: false, error: "Failed to fetch entries" });
  }
});

// POST /api/admin/finance — create entry
router.post("/", isAdminAuthorized, async (req, res) => {
  const { type, name, price, source, date } = req.body;
  if (!type || !name || price == null || !source || !date) {
    return res.status(400).json({ success: false, error: "type, name, price, source, and date are required" });
  }
  if (!["expense", "revenue"].includes(type)) {
    return res.status(400).json({ success: false, error: "type must be 'expense' or 'revenue'" });
  }
  try {
    const entry = await FinanceEntry.create({ type, name, price, source, date });
    res.status(201).json({ success: true, data: entry });
  } catch (e) {
    console.error("POST /api/admin/finance error:", e);
    res.status(500).json({ success: false, error: "Failed to create entry" });
  }
});

// PUT /api/admin/finance/:id — update entry
router.put("/:id", isAdminAuthorized, async (req, res) => {
  const { type, name, price, source, date } = req.body;
  try {
    const entry = await FinanceEntry.findByIdAndUpdate(
      req.params.id,
      { type, name, price, source, date },
      { new: true, runValidators: true }
    );
    if (!entry) return res.status(404).json({ success: false, error: "Entry not found" });
    res.json({ success: true, data: entry });
  } catch (e) {
    console.error("PUT /api/admin/finance/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to update entry" });
  }
});

// DELETE /api/admin/finance/:id
router.delete("/:id", isAdminAuthorized, async (req, res) => {
  try {
    const entry = await FinanceEntry.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: "Entry not found" });
    res.json({ success: true, message: "Entry deleted" });
  } catch (e) {
    console.error("DELETE /api/admin/finance/:id error:", e);
    res.status(500).json({ success: false, error: "Failed to delete entry" });
  }
});

export default router;
