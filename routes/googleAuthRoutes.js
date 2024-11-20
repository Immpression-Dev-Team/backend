// routes/googleAuthRoutes.js
import express from 'express';
import jwt from 'jsonwebtoken';
import UserModel from '../models/users.js';

const router = express.Router();

const handleGoogleAuth = async (req, res, isSignUp) => {
  try {
    const { googleId, email, name, picture } = req.body;
    console.log('Processing Google auth request:', { email, name, googleId });

    try {
      // Find existing user
      let user = await UserModel.findOne({ email });
      console.log('Existing user check:', user ? 'Found' : 'Not found');

      if (isSignUp) {
        if (user) {
          console.log('User already exists:', email);
          return res.status(400).json({
            success: false,
            message: 'Email already registered'
          });
        }

        try {
          user = new UserModel({
            email,
            name,
            googleId,
            profilePictureLink: picture,
            password: undefined, // Skip password for Google users
            authProvider: 'google'
          });

          await user.save({ validateBeforeSave: false });
          console.log('New Google user created:', { email: user.email, id: user._id });
        } catch (saveError) {
          console.error('Error saving user:', saveError);
          throw saveError;
        }
      } else if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found. Please sign up first.'
        });
      }

      // Generate token
      const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Send successful response
      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          googleId: user.googleId,
          profilePictureLink: user.profilePictureLink,
          bio: user.bio,
          artistType: user.artistType,
          views: user.views,
          accountType: user.accountType
        }
      });

    } catch (dbError) {
      console.error('Database operation failed:', dbError);
      throw dbError;
    }

  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Authentication failed'
    });
  }
};

// Handle Google signup
router.post('/auth/google/signup', async (req, res) => {
  console.log('Google signup request received');
  await handleGoogleAuth(req, res, true);
});

// Handle Google login
router.post('/auth/google/login', async (req, res) => {
  console.log('Google login request received');
  await handleGoogleAuth(req, res, false);
});

export default router;