import jwt from 'jsonwebtoken';
import UserModel from '../models/users.js';
import AdminUserModel from '../models/admin-users.js';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const { JWT_SECRET } = process.env;

if (!JWT_SECRET) {
  throw new Error('Invalid env variable: JWT_SECRET');
} else {
  console.log('JWT_SECRET loaded');
}

export const generateAuthToken = (_id) => {
  return jwt.sign({ _id }, JWT_SECRET, { expiresIn: '7d' });
};

export const generateAdminAuthToken = (admin, expiresIn) => {
  return jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn });
};

export const setAuthCookies = (res, value) => {
  res.cookie('auth-token', value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: value ? 7 * 24 * 60 * 60 * 1000 : 0,
  });
};

export const getAuthToken = (headers) => {
  const authHeader = headers.authorization || headers.Authorization;

  // if header is invalid/ misses token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.split(' ')[1];
};

export const isUserAuthorized = async (req, res, next) => {
  const token = getAuthToken(req.headers);

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authorization header missing or invalid' });
  }

  try {
    const data = jwt.verify(token, JWT_SECRET);
    if (typeof data !== 'string') {
      const user = await UserModel.findById(data._id).select('+passwordChangedAt').catch((error) => {
        console.error('Error finding user:', error);
        return null;
      });

      if (!user) {
        return res.status(401).json({ success: false, error: 'User not found' });
      }

      // Check if the password was changed after the token was issued
      const tokenIssuedAt = data.iat * 1000; // Convert to milliseconds
      if (user.passwordChangedAt && user.passwordChangedAt > tokenIssuedAt) {
        return res.status(401).json({
          success: false,
          error: 'Password has been changed. Please log in again.',
        });
      }

      req.user = user;
      req.token = token;
      return next();
    }
    return res.status(401).json({ success: false, error: 'Invalid token payload' });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

export const isAdminAuthorized = async (req, res, next) => {
  const token = getAuthToken(req.headers);

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authorization header missing or invalid' });
  }

  try {
    const data = jwt.verify(token, JWT_SECRET);
    if (typeof data !== 'string') {
      const admin = await AdminUserModel.findById(data.id).catch((error) => {
        console.error('Error finding admin:', error);
        return null;
      });

      if (admin) {
        req.admin = admin;
        req.token = token;
        return next();
      }
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token payload' });
  } catch (error) {
    console.error('Admin Token verification error:', error);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

export const validatePrice = (price) => {
  const price_val = parseFloat(price);
  return isNaN(price_val) || !isFinite(price_val) ? null : price_val;
};

export const validateImageLink = (imageLink) => {
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
  windowMs: 60 * 1000,
  max: 3,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many OTP requests. Please try again after a minute.',
  },
});