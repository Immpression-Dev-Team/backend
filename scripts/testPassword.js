import mongoose from "mongoose";
import dotenv from "dotenv";
import argon2 from "argon2"; 
import AdminUserModel from "../models/admin-users.js"; 

dotenv.config();

async function testPassword() {
  try {
    await mongoose.connect(process.env.MONGO_URL);

    const email = "testing@gmail.com";
    const enteredPassword = "Testing123!";

    const admin = await AdminUserModel.findOne({ email }).select("+password");

    if (!admin) {
      console.log("❌ Admin not found!");
      process.exit(1);
    }

    console.log("🔑 Stored Hashed Password:", admin.password);
    console.log("🔑 Entered Password:", enteredPassword);

    // ✅ Use argon2 to verify
    const isMatch = await argon2.verify(admin.password, enteredPassword);
    console.log("✅ Password Match Result:", isMatch);

    process.exit();
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

testPassword();
