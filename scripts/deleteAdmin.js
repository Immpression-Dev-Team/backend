import mongoose from "mongoose";
import dotenv from "dotenv";
import AdminUserModel from "../models/admin-users.js";

dotenv.config();

async function deleteAdmin() {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error("❌ MONGO_URL is not defined. Check your .env file.");
    }

    await mongoose.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const email = "testing@gmail.com"; // Change this if necessary

    // Find and delete the admin
    const result = await AdminUserModel.deleteOne({ email });

    if (result.deletedCount === 1) {
      console.log(`✅ Admin with email ${email} deleted successfully.`);
    } else {
      console.log(`⚠️ No admin found with email ${email}.`);
    }

    process.exit();
  } catch (error) {
    console.error("❌ Error deleting admin:", error);
    process.exit(1);
  }
}

deleteAdmin();
