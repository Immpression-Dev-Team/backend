import express from "express";
// ✅ Use argon2 instead of bcrypt
// import argon2 from "argon2";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import AdminUserModel from "../../models/admin-users.js";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import ImageModel from "../../models/images.js";

const router = express.Router();

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        console.log(
            "🔍 Searching for admin with email:",
            email.trim().toLowerCase()
        );

        const admin = await AdminUserModel.findOne({
            email: email.trim().toLowerCase(),
        }).select("+password");

        if (!admin) {
            console.log("❌ Admin not found");
            return res.status(401).json({ message: "Admin not found" });
        }

        console.log("✅ Admin found:", admin.email);
        console.log("🔑 Stored Hashed Password:", admin.password);
        console.log("🔑 Entered Plain Password:", password);

        // ✅ Use argon2 to verify password
        // const isMatch = await argon2.verify(admin.password, password);
        const isMatch = await bcrypt.compare(password, admin.password);
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
    res.status(200).json({
        success: true,
        message: `Welcome, ${req.admin.name}!`,
        role: req.admin.role,
    });
});

// ✅ NEW: Admin-only route to get all images (without pagination)
router.get("/all_images", isAdminAuthorized, async (req, res) => {
    try {
        // Fetch all images without filters
        const images = await ImageModel.find({});

        // Format response data
        const responseData = images.map((image) => ({
            _id: image._id,
            artistName: image.artistName,
            name: image.name,
            description: image.description,
            price: image.price,
            imageLink: image.imageLink,
            views: image.views,
            category: image.category,
            createdAt: image.createdAt,
            stage: image.stage, // ✅ Include the stage (useful for review)
        }));

        return res.status(200).json({
            success: true,
            totalImages: images.length,
            images: responseData,
        });
    } catch (error) {
        console.error("Error fetching all images for admin:", error);
        return res.status(500).json({
            success: false,
            error: "Internal Server Error",
        });
    }
});

// ✅ Get a single artwork by ID
router.get("/art/:id", isAdminAuthorized, async (req, res) => {
    try {
        const { id } = req.params;
        const art = await ImageModel.findById(id);

        if (!art) {
            return res.status(404).json({ success: false, error: "Artwork not found" });
        }

        res.status(200).json({ success: true, art });
    } catch (error) {
        console.error("Error fetching artwork:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// ✅ Admin-only route to approve an artwork
router.put("/art/:id/approve", isAdminAuthorized, async (req, res) => {
    try {
        const { id } = req.params;
        const adminEmail = req.admin.email; // ✅ Get admin's email from JWT token

        const updatedArt = await ImageModel.findByIdAndUpdate(
            id,
            { 
                stage: "approved",
                reviewedByEmail: adminEmail, // ✅ Save the email of the approving admin
                reviewedAt: new Date() // ✅ Save the timestamp
            },
            { new: true }
        );

        if (!updatedArt) {
            return res.status(404).json({ success: false, error: "Artwork not found" });
        }

        res.status(200).json({ success: true, message: "Artwork approved", art: updatedArt });
    } catch (error) {
        console.error("Error approving artwork:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});


// ✅ Admin-only route to reject an artwork
router.put("/art/:id/reject", isAdminAuthorized, async (req, res) => {
    try {
        const { id } = req.params;
        const adminEmail = req.admin.email; // ✅ Get admin's email from JWT token

        const updatedArt = await ImageModel.findByIdAndUpdate(
            id,
            { 
                stage: "rejected",
                reviewedByEmail: adminEmail, // ✅ Save the email of the rejecting admin
                reviewedAt: new Date() // ✅ Save the timestamp
            },
            { new: true }
        );

        if (!updatedArt) {
            return res.status(404).json({ success: false, error: "Artwork not found" });
        }

        res.status(200).json({ success: true, message: "Artwork rejected", art: updatedArt });
    } catch (error) {
        console.error("Error rejecting artwork:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});



export default router;
