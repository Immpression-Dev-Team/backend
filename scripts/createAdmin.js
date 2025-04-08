import mongoose from "mongoose";
import dotenv from "dotenv";
// ✅ Ensure argon2 is imported
// import argon2 from "argon2";
import AdminUserModel from "../models/admin-users.js";

dotenv.config();

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URL);

    const email = "ajaipremo@gmail.com";
    const existingAdmin = await AdminUserModel.findOne({ email });

    if (existingAdmin) {
      console.log("⚠️ Admin already exists.");
      process.exit(1);
    }

    // ✅ Hash password with argon2
    // const hashedPassword = await argon2.hash("Testing123!");

    const newAdmin = new AdminUserModel({
      email,
      name: "AJ Premo",
      // ✅ Save the argon2 hash
      //password: "Ajajlws24",
      role: "super-admin",
    });

    await newAdmin.save();
    console.log("✅ Admin created successfully!");
    // console.log("🔑 Hashed Password Stored in DB:", hashedPassword);

    process.exit();
  } catch (error) {
    console.error("❌ Error creating admin:", error);
    process.exit(1);
  }
}

createAdmin();
