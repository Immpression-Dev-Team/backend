// Import the jwt token library
import jwt from "jsonwebtoken";
// Import the user model
import UserModel from "../models/users.js";
// Import the admin user model
import AdminUserModel from "../models/admin-users.js"; // Ensure the path is correct
// Import dotenv to load environment variables from a .env file
import dotenv from "dotenv";

// Load environment variables from the .env file
dotenv.config();

// Destructure the JWT_SECRET variable from the environment variables
const { JWT_SECRET } = process.env;

// Check if JWT_SECRET is defined
if (!JWT_SECRET) {
  throw new Error("Invalid env variable: JWT_SECRET");
} else {
  console.log("JWT_SECRET loaded");
}

// ✅ Function to generate a JWT token for a user
export const generateAuthToken = (_id) => {
  return jwt.sign({ _id }, JWT_SECRET, { expiresIn: "7d" });
};

// ✅ Function to set authentication cookies in the response
export const setAuthCookies = (response, value) => {
  response.cookie("auth-token", value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: value ? 7 * 24 * 60 * 60 * 1000 : 0,
  });
};

// ✅ Middleware to check if the user is authorized (Regular Users)
export const isUserAuthorized = async (request, response, next) => {
  const authHeader = request.headers["authorization"];

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    if (token) {
      try {
        const data = jwt.verify(token, JWT_SECRET);
        if (typeof data !== "string") {
          const user = await UserModel.findById(data._id).catch((error) => {
            console.error("Error finding user:", error);
            return null;
          });

          if (user) {
            request.user = user;
            request.token = token;
            return next();
          }
        }
      } catch (error) {
        console.error("Token verification error:", error);
      }
    }
  }
  return response.status(401).json({ success: false, error: "Unauthorized" });
};

// ✅ Middleware to check if an ADMIN is authorized
export const isAdminAuthorized = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    if (token) {
      try {
        const data = jwt.verify(token, JWT_SECRET);
        
        if (typeof data !== "string") {
          const admin = await AdminUserModel.findById(data.id).catch((error) => {
            console.error("Error finding admin:", error);
            return null;
          });

          if (admin) {
            req.admin = admin;
            req.token = token;
            return next();
          }
        }
      } catch (error) {
        console.error("❌ Admin Token verification error:", error);
        return res.status(401).json({ success: false, error: "Invalid token" });
      }
    }
  }

  return res.status(401).json({ success: false, error: "Admin access denied" });
};


// ✅ Ensure price is a float
export const validatePrice = (price) => {
  const price_val = parseFloat(price);
  return isNaN(price_val) || !isFinite(price_val) ? null : price_val;
};

// ✅ Validate image link matches the Cloudinary secure_url
export const validateImageLink = (imageLink) => {
  const urlRegex = new RegExp(
    "^https?://res.cloudinary.com/dttomxwev/image/upload(/(.*))?/(v[0-9]+)/?(artwork)?/(.+)(.[a-z]{3,4})"
  );
  return !urlRegex.test(imageLink) ? null : imageLink;
};
