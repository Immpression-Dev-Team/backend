// Import the jwt token library
import jwt from 'jsonwebtoken';
// Import the user model
import UserModel from '../models/users.js';
// Import the admin user model
import AdminUserModel from '../models/admin-users.js'; // Ensure the path is correct
// Import dotenv to load environment variables from a .env file
import dotenv from 'dotenv';

import rateLimit from 'express-rate-limit';

// Load environment variables from the .env file
dotenv.config();

// Destructure the JWT_SECRET variable from the environment variables
const { JWT_SECRET } = process.env;

// Check if JWT_SECRET is defined
if (!JWT_SECRET) {
  throw new Error('Invalid env variable: JWT_SECRET');
} else {
  console.log('JWT_SECRET loaded');
}

// ✅ Function to generate a JWT token for a user
export const generateAuthToken = (_id) => {
  return jwt.sign({ _id }, JWT_SECRET, { expiresIn: '7d' });
};

// ✅ Function to generate a JWT token for an admin user
export const generateAdminAuthToken = (admin, expiresIn) => {
  return jwt.sign(
    { id: admin.id, role: admin.role }, 
    JWT_SECRET,
    { expiresIn: expiresIn }
  );
};

// ✅ Function to set authentication cookies in the res
export const setAuthCookies = (res, value) => {
  res.cookie('auth-token', value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: value ? 7 * 24 * 60 * 60 * 1000 : 0,
  });
};

// ✅ Function to get authentication token from request header
export const getAuthToken = (headers) => {
  const authHeader = headers['authorization'] || headers['Authorization'];

  // if header is invalid/ misses token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing or invalid' });
  }

  return authHeader.split(' ')[1];
}

// ✅ Middleware to check if the user is authorized (Regular Users)
export const isUserAuthorized = async (req, res, next) => {
  // get token from request header
  const token = getAuthToken(req.headers);

  try {
    const data = jwt.verify(token, JWT_SECRET);
    if (typeof data !== 'string') {
      const user = await UserModel.findById(data._id).catch((error) => {
        console.error('Error finding user:', error);
        return null;
      });

      if (user) {
        req.user = user;
        req.token = token;
        return next();
      }
    }
  } catch (error) {
    console.error('Token verification error:', error);
  }
};

// ✅ Middleware to check if an ADMIN is authorized
export const isAdminAuthorized = async (req, res, next) => {
  // get token from request header
  const token = getAuthToken(req.headers);

  if (token) {
    try {
      const data = jwt.verify(token, JWT_SECRET);

      if (typeof data !== 'string') {
        const admin = await AdminUserModel.findById(data.id).catch(
          (error) => {
            console.error('Error finding admin:', error);
            return null;
          }
        );

        if (admin) {
          req.admin = admin;
          req.token = token;
          return next();
        }
        else {
          return res.status(404).json({ success: false, error: 'Admin user not found' });
        }
      }
    } catch (error) {
      console.error('❌ Admin Token verification error:', error);
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
  }
};

// ✅ Ensure price is a float
export const validatePrice = (price) => {
  const price_val = parseFloat(price);
  return isNaN(price_val) || !isFinite(price_val) ? null : price_val;
};

// ✅ Validate image link matches the Cloudinary secure_url
export const validateImageLink = (imageLink) => {
  // take cloudinery image w/ any name and extension (jpg,JPEG,etc.)
  const urlRegex = new RegExp(
    '^https?://res.cloudinary.com/dttomxwev/image/upload(/(.*))?/(v[0-9]+)/?(artwork)?/(.+)(.[a-z]{3,4})'
  );
  return !urlRegex.test(imageLink) ? null : imageLink;
};

export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const otpRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many OTP requests. Please try again after a minute.',
  },
});
