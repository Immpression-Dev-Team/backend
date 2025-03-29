import express from "express";
// ✅ Use argon2 instead of bcrypt
// import argon2 from "argon2";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import AdminUserModel from "../../models/admin-users.js";
import UserModel from "../../models/users.js"; // Import the User model
import { isAdminAuthorized, generateAdminAuthToken, getAuthToken } from "../../utils/authUtils.js";
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

        const token = generateAdminAuthToken(admin, '1hr');
        res.status(200).json({ message: "Admin logged in", token, email: admin.email });
    } catch (error) {
        console.error("❌ Server error:", error);
        res.status(500).json({ message: "Server error", error });
    }
});

// ✅ NEW: renew jwt token when it is close to expired after ~1hr
router.post('/renew_token', isAdminAuthorized, (req, res) => {
    const token = getAuthToken(req.headers);

    // generate & return a new token if the token is valid
    try{
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if(err){
                return res.status(401).send('Invalid refresh token');
            }

            const newToken = generateAdminAuthToken(decoded, '1hr');
            res.status(200).json({ token: newToken });
        })
    }
    catch(error){
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

// ✅ NEW: Admin-only route to get all images (with pagination)
router.get("/all_images", isAdminAuthorized, async (req, res) => {
    try {
        // define pagination metadata (curr page, #items per page) + its default value
        const page = parseInt(req.query.page) || 1;
        if (page <= 0) {
            return res.status(400).json({ error: "Invalid page number. Please provide a positive integer." });
        }

        const MAX_LIMIT = 50;
        const limit = parseInt(req.query.limit) || MAX_LIMIT;
        
        // query for specific stage status if provided (pending images might not have statuses so include those)
        const stage = req.query.stage;
        const queryStage = (stage === 'review') ? 
            { $or: [{ stage: 'review' }, { stage: { $exists: false } }] } :
            (
                stage ? { stage: stage } : {}
            );
        
        // query for artist name or title if provided
        const input = req.query.input;
        const queryInput = (input) ? { 
            $and: [{ 
                $or: [
                    { artistName: { $regex: input, $options: 'i' } },
                    { name: { $regex: input, $options: 'i' } }
                ]
            }] } : {};

        const query = {
            ...queryStage,
            ...queryInput,
        };

        // count total #pages & return empty page if overbound
        const totalCount = await ImageModel.countDocuments(query);
        const totalPages = Math.ceil(totalCount / limit);
        if(page > totalPages){
            return res.status(200).json({
                success: true,
                images: [],
                pagination: {
                    currentPage: 1,
                    totalPages: 1,
                    totalImages: 0,
                },
            });
        }

        // calculate #items to skip before fetch
        const skip = (page - 1) * limit;
        const images = await ImageModel.find(query)
            .skip(skip)
            .limit(limit)
            .exec();
        
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

        res.status(200).json({
            success: true,
            images: responseData,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalImages: totalCount,
            }
        });
    } catch (error) {
        console.error("Error fetching all images for admin:", error);
        return res.status(500).json({
            success: false,
            error: "Internal Server Error",
        });
    }
});

// ✅ NEW: Admin-only route to get images statistics (counting total, pending, etc.)
router.get("/all_images/stats", isAdminAuthorized, async (_, res) => {
    try{
        const totalCount = await ImageModel.countDocuments();

        // counted images w/o stage attribute
        const pendingCount = await ImageModel.countDocuments({
            $or: [
                { stage: 'review' },
                { stage: { $exists: false } }
            ]
        });
        const approvedCount = await ImageModel.countDocuments({ stage: 'approved' });
        const rejectedCount = await ImageModel.countDocuments({ stage: 'rejected' });

        res.status(200).json({
            success: true,
            stats:{
                total: totalCount,
                pending: pendingCount,
                approved: approvedCount,
                rejected: rejectedCount,
            }
        })
    }
    catch (error){
        console.error("Error fetching images stats for admin:", error);
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

// ✅ Admin-only route to get all users
router.get("/users", isAdminAuthorized, async (req, res) => {
    try {
        const users = await UserModel.find({}, "name email role createdAt profilePictureLink");

        if (!users.length) {
            return res.status(404).json({ success: false, error: "No users found" });
        }

        return res.status(200).json({ success: true, totalUsers: users.length, users });
    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// ✅ Admin-only route to get a single user by ID with all details
router.get("/user/:id", isAdminAuthorized, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await UserModel.findById(id).select("-password"); // ✅ Exclude password for security

        if (!user) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        return res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Error fetching user details:", error);
        return res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

export default router;
