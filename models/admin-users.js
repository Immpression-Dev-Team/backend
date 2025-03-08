import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

const AdminUserSchema = new Schema(
    {
        email: {
            type: String,
            unique: true,
            required: [true, "Email is required"],
            match: [
                /^\w+(\.\w+)*@\w+([\-]?\w+)*(\.\w{2,3})+$/,
                "Invalid email address",
            ],
        },
        name: {
            type: String,
            required: [true, "Name is required"],
            minLength: [4, "Name should be at least 4 characters"],
            maxLength: [30, "Name should be less than 30 characters"],
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            select: false, // Prevent password from being retrieved in queries
            minLength: [6, "Password should be at least 6 characters"],
            maxLength: [30, "Password should be less than 30 characters"],
        },
        role: {
            type: String,
            enum: ["super-admin", "moderator"],
            required: true,
        },
    },
    { timestamps: true }
);

// Middleware to hash password before saving
AdminUserSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// Method to compare passwords
AdminUserSchema.methods.comparePassword = async function (enteredPassword) {
    return bcrypt.compare(enteredPassword, this.password);
};

// Create AdminUser model or retrieve existing one
const AdminUserModel = mongoose.models.AdminUser || mongoose.model("AdminUser", AdminUserSchema);

export default AdminUserModel;
