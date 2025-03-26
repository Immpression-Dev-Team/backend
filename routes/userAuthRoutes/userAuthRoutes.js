// Import the Express framework
import express from 'express';
import bcrypt from 'bcrypt';

// Import bcryptjs for password hashing and comparison
// import bcrypt from "bcryptjs";

// Import the Mongoose library for MongoDB
import mongoose from 'mongoose';

// Destructure the compare function from bcrypt
const { compare, hash } = bcrypt;

// Import the user model
import UserModel from '../../models/users.js';

// Import utility functions for authentication
import {
  setAuthCookies,
  generateAuthToken,
  otpRateLimiter,
  isValidEmail,
} from '../../utils/authUtils.js';

import { isUserAuthorized } from '../../utils/authUtils.js';

// Import dotenv
import dotenv from 'dotenv';
// Load environment variables from the .env file
dotenv.config();

import cloudinary from 'cloudinary';

// Import OAuth2Client from google-auth-library
import { OAuth2Client } from 'google-auth-library';

// Initialize Google OAuth client after other configurations
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
import OTP from '../../models/otp.js';
import { generateOtpEmailTemplate } from '../../utils/email.js';
import sendEmail from '../../services/email.js';

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD,
  api_key: process.env.CLOUDINARY_API,
  api_secret: process.env.CLOUDINARY_SECRET,
});

// Create a new Express router
const router = express.Router();

// Route for OTP request
router.post('/request-otp', otpRateLimiter, async (request, response) => {
  try {
    const { email, password } = request.body;

    if (!email || !isValidEmail(email)) {
      return response
        .status(401)
        .json({ success: false, message: 'Invalid Email Address' });
    }

    if (!password) {
      return response
        .status(401)
        .json({ success: false, message: 'Please input password' });
    }

    const existingUser = await UserModel.findOne({ email });
    if (existingUser?.isVerified) {
      return response.status(409).json({
        success: false,
        message: 'Email already registered. Please Login.',
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const saltRounds = 10;
    const hashedOtp = await hash(otp, saltRounds);

    await OTP.findOneAndUpdate(
      { email },
      { codeHash: hashedOtp, createdAt: new Date(), verified: false },
      { upsert: true }
    );

    // send email
    const html = generateOtpEmailTemplate(otp, email);
    await sendEmail(email, 'Registration OTP', html);

    if (!existingUser) {
      await UserModel.create({ email, password });
    }

    return response.status(200).json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (error) {
    console.log('OTP request failed', error);

    return response.status(500).json({
      success: false,
      message: 'OTP request failed',
      details: error?.message,
    });
  }
});

router.post('/verify-otp', async (request, response) => {
  try {
    const { email, otp } = request.body;

    if (!email || !otp) {
      return response
        .status(401)
        .json({ success: false, message: 'Provide Email and OTP' });
    }

    const otpRecord = await OTP.findOne({ email });

    if (!otpRecord) {
      return response
        .status(401)
        .json({ success: false, message: 'Invalid Request - Not Found' });
    }

    const isOtpCorrect = await bcrypt.compare(otp, otpRecord.codeHash);

    if (!isOtpCorrect) {
      return response
        .status(400)
        .json({ success: false, message: 'Invalid OTP' });
    }

    const user = await UserModel.findOne({ email });
    if (!user) {
      return response
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    otpRecord.verified = true;
    user.isVerified = true;
    await user.save();
    await otpRecord.save();

    await OTP.deleteOne({ email });

    response.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      email,
    });
  } catch (error) {
    console.error('OTP verification failed', error);
    return response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to fcomplete user signup
router.post('/signup', async (request, response) => {
  try {
    const { name, email } = request.body;

    // Validate input
    if (!name || !email) {
      return response
        .status(400)
        .json({ success: false, error: 'Please provide all credentials' });
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({ email });
    if (!existingUser) {
      return response
        .status(404)
        .json({ success: false, error: 'User not found' });
    }

    existingUser.name = name;

    await existingUser.save();

    // Return success response
    return response.status(201).json({
      success: true,
      message: 'Signup successful',
      user: {
        id: existingUser._id,
        name: existingUser.name,
        email: existingUser.email,
      },
    });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      for (const field in error.errors) {
        const message = error.errors[field].message;
        return response.status(400).json({ success: false, error: message });
      }
    }

    console.error('Signup error:', error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route for user login
router.post('/login', async (request, response) => {
  try {
    const { email, password } = request.body;

    if (!email || !password) {
      return response
        .status(400)
        .json({ success: false, error: 'Email and password are required' });
    }

    const user = await UserModel.findOne({ email }).select('+password');

    if (!user) {
      return response
        .status(404)
        .json({ success: false, error: 'User not found' });
    }

    // const isPasswordCorrect = await compare(password, user.password);
    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      return response
        .status(401)
        .json({ success: false, error: 'Incorrect password' });
    }

    const authToken = generateAuthToken(user._id);

    setAuthCookies(response, authToken);

    response.status(200).json({
      success: true,
      message: 'Login successful',
      token: authToken,
      user: { user },
    });
  } catch (error) {
    console.error(error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route for user logout
router.post('/logout', (request, response) => {
  try {
    setAuthCookies(response, '');

    response
      .status(200)
      .json({ success: true, message: 'User logged out successfully' });
  } catch (error) {
    console.error(error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Endpoint to get the user's profile
router.get('/get-profile', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user._id; // Get the authenticated user's ID

    // Find the user by their ID, select the necessary fields
    const user = await UserModel.findById(userId, ['name', 'email', 'views']);

    if (!user) {
      return response.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    response.status(200).json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        views: user.views,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    response.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Route to get all users' profile pictures, bio, and artist type
router.get('/all-profile-pictures', async (request, response) => {
  try {
    // Find all users and select the necessary fields: name, email, profilePictureLink, bio, and artistType
    const users = await UserModel.find(
      {},
      {
        name: 1,
        email: 1,
        profilePictureLink: 1,
        bio: 1,
        artistType: 1,
        userId: 1,
      }
    );

    // Check if any users exist in the database
    if (!users || users.length === 0) {
      return response
        .status(404)
        .json({ success: false, error: 'No users found' });
    }

    // Filter out users who do not have a profile picture link (optional)
    const usersWithProfilePictures = users.filter(
      (user) => user.profilePictureLink
    );

    // Respond with the list of users and their profile picture links, bio, and artist type
    response.status(200).json({
      success: true,
      users: usersWithProfilePictures,
    });
  } catch (error) {
    console.error(error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route for adding/updating profile picture
router.post('/profile-picture', async (request, response) => {
  try {
    const { userId, profilePictureLink } = request.body;
    console.log(profilePictureLink);

    if (!userId || !profilePictureLink) {
      return response.status(400).json({
        success: false,
        error: 'User ID and profile picture link are required',
      });
    }

    const user = await UserModel.findById(userId);

    if (!user) {
      return response
        .status(404)
        .json({ success: false, error: 'User not found' });
    }

    // Update the user's profile picture link
    user.profilePictureLink = profilePictureLink;
    await user.save();

    response.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to get the user's profile picture based on userId
router.get('/profile-picture/:userId', async (request, response) => {
  try {
    const { userId } = request.params;
    console.log(`Received request for profile picture of userId: ${userId}`);

    const user = await UserModel.findById(userId);

    if (!user) {
      console.warn(`User with ID ${userId} not found.`);
      return response
        .status(404)
        .json({ success: false, error: 'User not found' });
    }

    if (!user.profilePictureLink) {
      console.warn(`User ${userId} has no profile picture.`);
      return response
        .status(404)
        .json({ success: false, error: 'Profile picture not found' });
    }

    console.log(
      `Returning profile picture for user ${userId}: ${user.profilePictureLink}`
    );

    response.status(200).json({
      success: true,
      profilePictureLink: user.profilePictureLink,
    });
  } catch (error) {
    console.error('Error fetching profile picture:', error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route for updating profile picture
router.put('/profile-picture', async (request, response) => {
  try {
    const { userId, profilePictureLink } = request.body;

    // Check if userId and profilePictureLink are provided
    if (!userId || !profilePictureLink) {
      return response.status(400).json({
        success: false,
        error: 'User ID and profile picture link are required',
      });
    }

    // Find the user by userId
    const user = await UserModel.findById(userId);

    if (!user) {
      return response.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Update the user's profile picture link
    user.profilePictureLink = profilePictureLink;
    await user.save();

    response.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Route for deleting profile picture
// Update delete-profile-picture route
router.post('/delete-profile-picture', async (req, res) => {
  const { public_id } = req.body;
  console.log('DELETING', public_id);

  try {
    const result = await cloudinary.v2.api.delete_resources(
      [`artists/${public_id}`],
      {
        type: 'upload',
        resource_type: 'image',
      }
    );

    if (result.deleted[public_id] === 'deleted') {
      console.log(`Image ${public_id} deleted successfully`);
      res.json({ success: true });
    } else {
      res.status(500).json({
        success: false,
        message: 'Image not found or already deleted in Cloudinary',
      });
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image',
      error,
    });
  }
});

// Endpoint to set or update the user's bio
router.put('/set-bio', isUserAuthorized, async (request, response) => {
  try {
    const { bio } = request.body;
    const userId = request.user._id; // Retrieve the authenticated user's ID

    // Check if the bio is provided
    if (!bio) {
      return response.status(400).json({
        success: false,
        error: 'Bio is required',
      });
    }

    // Find the user by userId and update the bio
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { bio },
      { new: true }
    );

    if (!user) {
      return response.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    response.status(200).json({
      success: true,
      message: 'Bio updated successfully',
      bio: user.bio,
    });
  } catch (error) {
    console.error('Error updating bio:', error);
    response.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Endpoint to get the user's bio
router.get('/get-bio', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user._id; // Retrieve the authenticated user's ID

    // Find the user by userId
    const user = await UserModel.findById(userId);

    if (!user) {
      return response.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    response.status(200).json({
      success: true,
      bio: user.bio || 'No bio available',
    });
  } catch (error) {
    console.error('Error fetching bio:', error);
    response.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Endpoint to set or update the user's artist type
router.put('/set-artist-type', isUserAuthorized, async (request, response) => {
  try {
    const { artistType } = request.body;
    const userId = request.user._id; // Retrieve the authenticated user's ID

    // Check if the artistType is provided
    if (!artistType) {
      return response.status(400).json({
        success: false,
        error: 'Artist type is required',
      });
    }

    // Find the user by userId
    const user = await UserModel.findById(userId);

    if (!user) {
      return response.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Update the user's artist type
    user.artistType = artistType;
    await user.save();

    response.status(200).json({
      success: true,
      message: 'Artist type updated successfully',
      artistType: user.artistType,
    });
  } catch (error) {
    console.error('Error updating artist type:', error);
    response.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Endpoint to set or update the user's art type (art-lover)
router.put(
  '/set-art-categories',
  isUserAuthorized,
  async (request, response) => {
    const userId = request.user.id;
    console.log('reqqq', request.body);

    try {
      const user = await UserModel.findById(userId);

      if (!user) {
        return response.status(404).json({ message: 'User not found' });
      }

      user.artCategories = request.body;
      await user.save();

      // Make sure to return a proper success response
      response.status(200).json({
        success: true,
        message: 'Art categories updated successfully',
      });
    } catch (error) {
      console.error(error);

      // Return a clear error response
      return response.status(400).json({
        success: false,
        message: 'Failed to update art categories',
        error: error.message, // Include the error message for debugging
      });
    }
  }
);

// Endpoint to get the user's artist type
router.get('/get-artist-type', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user._id; // Retrieve the authenticated user's ID

    // Find the user by userId
    const user = await UserModel.findById(userId);

    if (!user) {
      return response.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    response.status(200).json({
      success: true,
      artistType: user.artistType,
    });
  } catch (error) {
    console.error('Error fetching artist type:', error);
    response.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

router.patch('/increment-views/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the ID parameter
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing user ID',
      });
    }

    // Find user by ID and increment view count
    const updatedUser = await UserModel.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true, runValidators: true } // Return the updated document with validators
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: 'View count incremented successfully',
      user: {
        id: updatedUser._id,
        views: updatedUser.views,
      },
    });
  } catch (error) {
    console.error('Error incrementing views:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

router.get('/get-views', async (req, res) => {
  try {
    const userId = req.user.id; // Assuming your middleware sets req.user.id based on the token
    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      views: user.views, // Return the views count from the user document
    });
  } catch (error) {
    console.error('Error fetching views:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Endpoint to update accountType
router.post('/accountType', isUserAuthorized, async (req, res) => {
  const userId = req.user.id;
  const { accountType } = req.body;

  try {
    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.accountType = accountType;
    await user.save();

    res.status(200).json({ success: true, accountType });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update account type',
      error,
    });
  }
});

// Route for deleting a user account
router.delete('/delete-account', isUserAuthorized, async (req, res) => {
  try {
    const userId = req.user._id; // Get the authenticated user's ID

    // Find and delete the user from the database
    const user = await UserModel.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    console.log(`User ${userId} deleted from the database.`);

    res.status(200).json({
      success: true,
      message: 'User account deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting user account:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Route to update user profile fields (name, email, password)
router.put('/update-profile', isUserAuthorized, async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, email, password } = req.body;

    // Find the user by ID
    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Update fields if provided
    if (name) user.name = name;
    if (email) user.email = email;

    // If password is provided, hash it before saving
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    // Save the updated user profile
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: { name: user.name, email: user.email },
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Route for Google login
router.post('/google-login', async (request, response) => {
  try {
    const { token } = request.body;
    console.log('token', token);
    // Verify the Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name, picture } = ticket.getPayload();

    // Check if user exists
    let user = await UserModel.findOne({ email });

    if (!user) {
      // Create new user if doesn't exist
      user = await UserModel.create({
        name,
        email,
        profilePictureLink: picture,
        password: `GOOGLE_LOGIN_${Math.random().toString(36).slice(-8)}`, // Random password for Google users
        isGoogleUser: true,
      });
    }

    // Generate auth token
    const authToken = generateAuthToken(user._id);

    // Set auth cookies
    setAuthCookies(response, authToken);

    response.status(200).json({
      success: true,
      message: 'Google login successful',
      token: authToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profilePictureLink: user.profilePictureLink,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    response.status(500).json({
      success: false,
      error: 'Failed to login with Google',
    });
  }
});

// Export the router
export default router;
