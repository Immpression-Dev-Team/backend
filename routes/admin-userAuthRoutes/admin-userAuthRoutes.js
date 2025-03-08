import express from "express";
import argon2 from "argon2"; // ✅ Use argon2 instead of bcrypt
import jwt from "jsonwebtoken";
import AdminUserModel from "../../models/admin-users.js";
import { isAdminAuthorized } from "../../utils/authUtils.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log("🔍 Searching for admin with email:", email.trim().toLowerCase());

    const admin = await AdminUserModel.findOne({ email: email.trim().toLowerCase() }).select("+password");

    if (!admin) {
      console.log("❌ Admin not found");
      return res.status(401).json({ message: "Admin not found" });
    }

    console.log("✅ Admin found:", admin.email);
    console.log("🔑 Stored Hashed Password:", admin.password);
    console.log("🔑 Entered Plain Password:", password);

    // ✅ Use argon2 to verify password
    const isMatch = await argon2.verify(admin.password, password);
    console.log("🔎 Password Match Result:", isMatch);

    if (!isMatch) {
      console.log("❌ Password does not match");
      return res.status(401).json({ message: "Invalid credentials" });
    }

    console.log("✅ Password matches!");

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({ message: "Admin logged in", token });
  } catch (error) {
    console.error("❌ Server error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

// ✅ Protected admin dashboard route
router.get("/dashboard", isAdminAuthorized, (req, res) => {
  res.status(200).json({ success: true, message: `Welcome, ${req.admin.name}!`, role: req.admin.role });
});

export default router;
