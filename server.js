// Import the Express framework
import express from 'express';

// Import the Mongoose library for MongoDB
import mongoose from 'mongoose';

// Import cookie-parser middleware for parsing cookies
import cookieParser from 'cookie-parser';

// Import morgan for logging requests
import morgan from 'morgan';

// Import authentication routes
import authRoutes from './routes/userAuthRoutes/userAuthRoutes.js';

// Import image handling routes
import imageRoutes from './routes/imageRoutes/imageRoutes.js';

// Import order handling routes
import orderRoutes from './routes/orderRoutes/orderRoutes.js'; // New import

// Import admin authentication routes
import adminAuthRoutes from './routes/admin-userAuthRoutes/admin-userAuthRoutes.js';

// Import admin-protected routes
import adminRoutes from './routes/admin-userAuthRoutes/admin-userAuthRoutes.js';

// Import the MongoDB connection URL from config file
import { MONGO_URL } from './config/config.js';

// Import body-parser
import bodyParser from 'body-parser';

// Import cors
import cors from 'cors';

// Import dotenv
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Build acceptable origins dynamically
const corsOrigins = [
    `http://admin:${process.env.VITE_APP_ADMIN_PORT}`, // Admin service
    `http://localhost:${process.env.VITE_APP_WEB_PORT}`,   // Web service
    `http://${process.env.HOST_IP}:19000`, // Expo Go
    `http://${process.env.HOST_IP}:8081`, // Expo Development Build
    `http://localhost:5173`
];

console.log("origins list:", corsOrigins)

// Create an Express application
const app = express();

app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    console.log(`Origin: ${req.headers.origin}`);
    next();
});

// Middleware to parse JSON bodies in incoming requests
app.use(express.json());

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
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true, // Allow cookies
    })
);


// Define a custom log format for Morgan
const customFormat =
  '[:date[clf]] :method :url :status :res[content-length] - :response-time ms';

// Use Morgan middleware to log HTTP requests with the defined custom format
app.use(morgan(customFormat));

import jwt from "jsonwebtoken";

app.post("/refresh-token", (req, res) => {
    const { token: oldToken } = req.body;

    if (!oldToken) return res.status(401).json({ success: false, error: "No token provided" });

    jwt.verify(oldToken, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, error: "Invalid or expired token" });

        const newToken = jwt.sign({ _id: decoded._id }, process.env.JWT_SECRET, {
            expiresIn: "1h",
        });

        res.json({ success: true, token: newToken });
    });
});

// Use authentication routes for root path
app.use('/', authRoutes);

// Use image routes for root path
app.use('/', imageRoutes);

// Use order routes for root path
app.use('/', orderRoutes); // New route for orders

// Use admin authentication routes
app.use('/api/admin', adminAuthRoutes);

// Use admin protected routes
app.use('/api/admin', adminRoutes);

// Middleware to parse URL-encoded bodies in incoming requests
app.use(bodyParser.urlencoded({ extended: false }));

// Middleware to parse JSON bodies in incoming requests
app.use(bodyParser.json());

// Define the server port number
const PORT = process.env.BACKEND_PORT || 4000;

// Connect to MongoDB using Mongoose
mongoose
  // Connect to MongoDB using the provided URL
  .connect(MONGO_URL)
  // Log successful connection
  .then(() => console.log('MongoDB connection successful'))
  // Handle connection errors
  .catch((error) => {
    // Log the error
    console.error('Error connecting to MongoDB:', error);
    // Exit the process with an error code
    process.exit(1);
  });

// Default server route
app.get('/', (req, res) => {
  res.send({ status: 'Server is running' });
});

// Start the server and listen on the defined port
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
