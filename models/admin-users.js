import mongoose from 'mongoose';

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
          // Define the name field with type String and validation
          name: {
            type: String,
            required: [true, "Name is required"],
            minLength: [4, "Name should be at least 4 characters"],
            maxLength: [30, "Name should be less than 30 characters"],
          },
          // Define the password field with type String and validation
          password: {
            type: String,
            required: [true, "Password is required"],
            select: false,
            minLength: [6, "Password should be at least 6 characters"],
            maxLength: [30, "Password should be less than 30 characters"],
          },
    },
    { timestamps: true }
)

const AdminUserModel = mongoose.models.AdminUserModel || mongoose.model("AdminUser", AdminUserSchema);

export default AdminUserModel