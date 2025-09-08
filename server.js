// Import the Express framework
import express from "express";

// Import the Mongoose library for MongoDB
import mongoose from "mongoose";

// Import cookie-parser middleware for parsing cookies
import cookieParser from "cookie-parser";

// Import morgan for logging requests
import morgan from "morgan";

// Import authentication routes
import authRoutes from "./routes/userAuthRoutes/userAuthRoutes.js";

// Import image handling routes
import imageRoutes from "./routes/imageRoutes/imageRoutes.js";

// Import order handling routes
import orderRoutes from "./routes/orderRoutes/orderRoutes.js";

// Import admin authentication/protected routes
import adminAuthRoutes from "./routes/admin-userAuthRoutes/admin-userAuthRoutes.js";

// Import the new web donations routes (platform-only)
import webDonationsRoutes from "./routes/webDonationsRoutes/webDonationsRoutes.js";

// Notifications routes
import notificationRoutes from "./routes/notificationRoutes/notificationRoutes.js";

// Import the MongoDB connection URL from config file
import { MONGO_URL } from "./config/config.js";

// Import body-parser (only for urlencoded forms)
import bodyParser from "body-parser";

// Import cors
import cors from "cors";

// Import dotenv
import dotenv from "dotenv";

// JWT for refresh endpoint
import jwt from "jsonwebtoken";

// Load environment variables
dotenv.config();

// Build acceptable origins dynamically
const corsOrigins = [
  `http://admin:${process.env.VITE_APP_ADMIN_PORT}`, // Admin service
  `http://localhost:${process.env.VITE_APP_WEB_PORT}`, // Web service
  `http://${process.env.HOST_IP}:19000`, // Expo Go
  `http://${process.env.HOST_IP}:8081`, // Expo Development Build
  `http://${process.env.HOST_IP}:8083`,
  "http://localhost:5173", // Admin Locally
  "http://localhost:3000", // Admin Locally
  "https://immpression-admin.vercel.app", // Admin Online
  "https://www.immpression.art", // Website
];

// Create an Express application
const app = express();

// Simple request logger (in addition to morgan) for quick visibility
app.use((req, _res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  console.log(`Origin: ${req.headers.origin}`);
  next();
});

/**
 * Keep Stripe webhook bodies RAW where needed:
 * - /api/web/donations/webhook  (handled inside webDonationsRoutes with express.raw)
 * - /webhook                    (orders webhook defined inside orderRoutes)
 *
 * Everything else gets JSON parsing.
 */
app.use((req, res, next) => {
  const rawPaths = new Set([
    "/api/web/donations/webhook",
    "/webhook",
  ]);
  if (rawPaths.has(req.originalUrl)) return next(); // route-level express.raw() will handle it
  return express.json()(req, res, next);
});

// Middleware to parse cookies in incoming requests
app.use(cookieParser());

// Middleware to allow cross-origin requests
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, Postman)
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies
  })
);

// Define a custom log format for Morgan
const customFormat =
  "[:date[clf]] :method :url :status :res[content-length] - :response-time ms";

// Use Morgan middleware to log HTTP requests with the defined custom format
app.use(morgan(customFormat));

/**
 * Optional: URL-encoded forms (if you need them elsewhere).
 * Do NOT add another JSON parser here—already handled above.
 */
app.use(bodyParser.urlencoded({ extended: false }));

// ----- Auth token refresh -----
app.post("/refresh-token", (req, res) => {
  const { token: oldToken } = req.body;

  if (!oldToken)
    return res.status(401).json({ success: false, error: "No token provided" });

  jwt.verify(oldToken, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res
        .status(403)
        .json({ success: false, error: "Invalid or expired token" });

    const newToken = jwt.sign({ _id: decoded._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({ success: true, token: newToken });
  });
});

// ----- Routes -----
// User auth / images / orders on root
app.use("/", authRoutes);
app.use("/", imageRoutes);
app.use("/", orderRoutes);

// Notifications at /notifications (avoids clobbering "/")
app.use("/notifications", notificationRoutes);

// Admin routes
app.use("/api/admin", adminAuthRoutes);

// Web donations (platform-only; includes /donations/create-checkout-session and /donations/webhook)
app.use("/api/web", webDonationsRoutes);

// ----- Database connection -----
const PORT = process.env.BACKEND_PORT || 4000;

mongoose
  .connect(MONGO_URL)
  .then(() => console.log("MongoDB connection successful"))
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  });

// Default server route
app.get("/", (_req, res) => {
  res.send({ status: "Server is running" });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
