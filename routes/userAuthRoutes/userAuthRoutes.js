// Import the Express framework
import express from 'express';

// Import bcryptjs for password hashing and comparison
import bcrypt from 'bcryptjs';

// Import the Mongoose library for MongoDB
import mongoose from 'mongoose';

// Destructure the compare function from bcrypt
const { compare } = bcrypt;

// Import the user model
import UserModel from '../../models/users.js';

// Import utility functions for authentication
import { setAuthCookies, generateAuthToken } from '../../utils/authUtils.js';

import { isUserAuthorized } from '../../utils/authUtils.js';

import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';

// Import dotenv
import dotenv from 'dotenv';
// Load environment variables from the .env file
dotenv.config();

import cloudinary from 'cloudinary';

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD,
  api_key: process.env.CLOUDINARY_API,
  api_secret: process.env.CLOUDINARY_SECRET,
});

// Create a new Express router
const router = express.Router();

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Route for user signup
router.post('/signup', async (request, response) => {
  try {
    const { name, email, password } = request.body;

    const userExists = await UserModel.findOne({ email });

    if (userExists) {
      return response
        .status(409)
        .json({ success: false, error: 'User already exists' });
    }

    const newUser = await UserModel.create({
      name,
      email,
      password,
    });

    console.log('New user created successfully');

    response
      .status(200)
      .json({ success: true, message: 'Signup successful', user: newUser });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      for (let field in error.errors) {
        const message = error.errors[field].message;
        return response.status(400).json({ success: false, message });
      }
    }

    console.error(error);
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

    const isPasswordCorrect = await compare(password, user.password);

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

    // Find the user by their userId
    const user = await UserModel.findById(userId);

    if (!user) {
      return response
        .status(404)
        .json({ success: false, error: 'User not found' });
    }

    // Check if the user has a profile picture link
    if (!user.profilePictureLink) {
      console.log('profile picture link not found');
      return response
        .status(404)
        .json({ success: false, error: 'Profile picture not found' });
    }

    // Respond with the profile picture link
    response.status(200).json({
      success: true,
      profilePictureLink: user.profilePictureLink,
    });
  } catch (error) {
    console.error(error);
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
  console.log(`DELETING`, public_id);

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
      response
        .status(200)
        .json({
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

// Google Authentication route
router.post('/auth/google', async (request, response) => {
  try {
    const { token } = request.body;

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Check if user already exists
    let user = await UserModel.findOne({ email });

    if (!user) {
      // Create new user if doesn't exist
      user = await UserModel.create({
        name,
        email,
        password: await bcrypt.hash(Math.random().toString(36), 10), // Generate random password
        profilePictureLink: picture,
        authProvider: 'google'
      });
    }

    // Generate authentication token
    const authToken = generateAuthToken(user._id);
    
    // Set authentication cookies
    setAuthCookies(response, authToken);

    response.status(200).json({
      success: true,
      message: 'Google login successful',
      token: authToken,
      user: { user }
    });
  } catch (error) {
    console.error('Google authentication error:', error);
    response.status(500).json({
      success: false,
      error: 'Google authentication failed'
    });
  }
});

// Facebook Authentication route
router.post('/auth/facebook', async (request, response) => {
  try {
    const { accessToken } = request.body;

    // Verify Facebook token and get user data
    const fbResponse = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
    );

    const { name, email, picture } = fbResponse.data;

    // Check if user already exists
    let user = await UserModel.findOne({ email });

    if (!user) {
      // Create new user if doesn't exist
      user = await UserModel.create({
        name,
        email,
        password: await bcrypt.hash(Math.random().toString(36), 10), // Generate random password
        profilePictureLink: picture?.data?.url,
        authProvider: 'facebook'
      });
    }

    // Generate authentication token
    const authToken = generateAuthToken(user._id);
    
    // Set authentication cookies
    setAuthCookies(response, authToken);

    response.status(200).json({
      success: true,
      message: 'Facebook login successful',
      token: authToken,
      user: { user }
    });
  } catch (error) {
    console.error('Facebook authentication error:', error);
    response.status(500).json({
      success: false,
      error: 'Facebook authentication failed'
    });
  }
});

// Export the router
export default router;
