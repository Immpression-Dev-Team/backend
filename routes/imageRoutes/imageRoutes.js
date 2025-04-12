// Importing the express module
import express from 'express';

// Importing the mongoose module
import mongoose from 'mongoose';

// Importing the multer module
import multer from 'multer';

// Importing the ImageModel from the models directory
import ImageModel from '../../models/images.js';
import UserModel from '../../models/users.js';

// Importing the isUserAuthorized function from the utils directory
import {
  isUserAuthorized,
  validatePrice,
  validateImageLink,
} from '../../utils/authUtils.js';

// Create a router instance with the router configuration
const router = express.Router();

// Store files in memory as Buffer objects
const storage = multer.memoryStorage();

// Create a multer instance with the storage configuration
const upload = multer({ storage: storage });

// Import the category type enum
import { IMAGE_CATEGORY } from '../../models/images.js';

// Import the IMAGE_STAGE enum
import { IMAGE_STAGE } from "../../models/images.js";

// POST route for uploading an image
router.post('/image', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user._id;
    const {
      artistName,
      name,
      imageLink,
      price,
      description,
      category,
      dimensions,
      isSigned,
      isFramed,
    } = request.body;    

    if (
      !artistName ||
      !name ||
      !imageLink ||
      !price ||
      !description ||
      !category
    ) {
      return response.status(400).json({
        success: false,
        error: 'Please fill in all fields, select a category, and select an image',
      });
    }

    if (!dimensions || isNaN(dimensions.height) || isNaN(dimensions.width)) {
      return response.status(400).json({
        success: false,
        error: "Dimensions must include valid height and width.",
      });
    }    

    const price_val = validatePrice(price);
    if (!price_val) {
      return response.status(400).json({
        success: false,
        error: 'Price should be a valid positive number',
      });
    }

    if (!validateImageLink(imageLink)) {
      return response.status(400).json({
        success: false,
        error: `Image link (${imageLink}) is not valid`,
      });
    }

    const res = await fetch(imageLink);
    if (res.status !== 200) {
      return response.status(400).json({ success: false, error: 'Image is not accessible' });
    }

    const newImage = await ImageModel.create({
      userId: userId,
      artistName: artistName,
      name: name,
      imageLink: imageLink,
      price: price_val,
      description: description,
      category: category,
      dimensions: {
        height: parseFloat(dimensions.height),
        width: parseFloat(dimensions.width),
      },
      isSigned: Boolean(isSigned),
      isFramed: Boolean(isFramed),
    });    
    console.log('New Image Saved:', newImage);

    return response.status(200).json({
      success: true,
      image: newImage,
      message: 'Image uploaded and saved successfully',
    });
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError) {
      const errorMsg = Object.values(err.errors).map((error) => error.message).join(', ');
      return response.status(400).json({ success: false, error: errorMsg });
    }
    console.error('Error Saving Image:', err);
    return response.status(500).json({ success: false, error: err.message });
  }
});

// Route to get all images from the database
router.get('/all_images', isUserAuthorized, async (request, response) => {
  try {
    const { page = 1, limit = 50 } = request.query;
    const query = {};
    const category = request.query.category;

    if (category) {
      if (!IMAGE_CATEGORY.includes(category)) {
        return response
          .status(400)
          .json({ success: false, error: 'Please provide a valid category' });
      } else {
        query.category = category;
      }
    }

    const skip = (page - 1) * limit;

    const images = await ImageModel.find(query)
      .limit(limit)
      .skip(skip)
      .select('_id userId artistName name description price imageLink views category createdAt stage');

    if (images.length === 0 && page > 1) {
      return response.status(200).json({ success: true, images: [] });
    }

    const totalImages = await ImageModel.countDocuments(query);
    const totalPages = Math.ceil(totalImages / limit);

    response.status(200).json({
      success: true,
      totalPages: totalPages,
      currentPage: parseInt(page),
      pageCount: limit,
      totalImages: totalImages,
      images,
    });
  } catch (error) {
    console.error('Error fetching images:', error);
    response.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to fetch all images liked by the current user
router.get('/image/liked-images', isUserAuthorized, async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await UserModel.findById(userId)
      .populate({
        path: 'likedImages',
        select: '_id name imageLink description price category createdAt userId',
        populate: { path: 'userId', select: 'name' },
      })
      .select('likedImages');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const formattedImages = user.likedImages.map(image => ({
      _id: image._id,
      name: image.name,
      imageLink: image.imageLink,
      description: image.description,
      price: image.price,
      category: image.category,
      createdAt: image.createdAt,
      artist: { name: image.userId?.name || 'Unknown Artist' }
    }));

    res.status(200).json({
      success: true,
      images: formattedImages,
    });
  } catch (error) {
    console.error('Error fetching liked images:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to fetch all images bought by the current user
router.get('/images/bought', isUserAuthorized, async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await UserModel.findById(userId)
      .populate({
        path: 'boughtImages',
        select: '_id name imageLink description price category createdAt userId',
        populate: { path: 'userId', select: 'name' },
      })
      .select('boughtImages');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const formattedImages = user.boughtImages.map(image => ({
      _id: image._id,
      name: image.name,
      imageLink: image.imageLink,
      description: image.description,
      price: image.price,
      category: image.category,
      createdAt: image.createdAt,
      artist: { name: image.userId?.name || 'Unknown Artist' },
    }));

    res.status(200).json({
      success: true,
      images: formattedImages,
    });
  } catch (error) {
    console.error('Error fetching bought images:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET route for fetching an image by ID
router.get('/image/:id', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user._id;
    const imageId = request.params.id;

    const image = await ImageModel.findOne({ _id: imageId, userId: userId });

    if (!image) {
      return response
        .status(404)
        .json({ success: false, error: 'Image not found' });
    }

    const responseData = {
      _id: image._id,
      artistName: image.artistName,
      name: image.name,
      description: image.description,
      price: image.price,
      imageLink: image.imageLink,
      category: image.category,
      views: image.views,
    };

    response.json(responseData);
  } catch (err) {
    console.error(err);
    response.status(500).json({ success: false, error: err.message });
  }
});

// Route to update an image by id
router.patch(
  '/image/:id',
  upload.single('image'),
  isUserAuthorized,
  async (request, response, next) => {
    try {
      const userId = request.user._id;
      const imageId = request.params.id;

      const updateImage = {};
      if (request.body.name) updateImage.name = request.body.name;
      if (request.file) {
        updateImage.imageFile = {
          data: request.file.buffer,
          contentType: request.file.mimetype,
        };
      }
      if (request.body.price) {
        const price_val = validatePrice(request.body.price);
        if (!price_val) {
          return response.status(400).json({
            success: false,
            error: 'Price should be a valid positive number',
          });
        }
        updateImage.price = price_val;
      }
      if (request.body.description)
        updateImage.description = request.body.description;
      if (request.body.category) updateImage.category = request.body.category;
      updateImage.$inc = { __v: 1 };

      const updatedImage = await ImageModel.findOneAndUpdate(
        { _id: imageId, userId: userId },
        updateImage,
        { new: true, runValidators: true }
      );

      if (!updatedImage) {
        return response.status(404).json({
          success: false,
          error: 'Image not found or not authorized to edit',
        });
      }

      response.status(200).json({
        success: true,
        msg: 'Image updated successfully',
        image: updatedImage,
      });
    } catch (error) {
      if (error instanceof mongoose.Error.ValidationError) {
        for (let field in error.errors) {
          const msg = error.errors[field].message;
          return response.status(400).json({ success: false, msg });
        }
      }

      console.error('Error updating image:', error);
      response
        .status(500)
        .json({ success: false, error: 'Internal Server Error' });
    }
  }
);

// Route to delete an image by id
router.delete('/image/:id', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user.id;
    const imageId = request.params.id;

    if (!userId) {
      return response
        .status(401)
        .json({ success: false, error: 'User not authorized' });
    }

    if (!imageId) {
      return response
        .status(400)
        .json({ success: false, error: 'Image ID is required' });
    }

    const deletedImage = await ImageModel.findOneAndDelete({
      _id: imageId,
      userId: userId,
    });

    if (!deletedImage) {
      return response.status(404).json({
        success: false,
        error: 'Image not found or not authorized to delete',
      });
    }

    response
      .status(200)
      .json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting image:', error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to get all images for the authenticated user
router.get('/images', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user.id;
    const { stage } = request.query;

    const query = { userId: userId };
    if (stage) {
      if (!Object.values(IMAGE_STAGE).includes(stage)) {
        return response.status(400).json({
          success: false,
          error: 'Invalid stage value',
        });
      }
      query.stage = stage;
    }

    const images = await ImageModel.find(query);
    response.status(200).json({ success: true, images });
  } catch (error) {
    console.error('Error fetching images:', error);
    response.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to update the view count of an image by id
router.patch('/increment-image-views/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      console.log('Invalid or missing image ID.');
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing image ID',
      });
    }

    console.log(`Received request to increment views for image ID: ${id}`);

    const updatedImage = await ImageModel.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true, runValidators: true }
    );

    if (!updatedImage) {
      console.log('Image not found.');
      return res.status(404).json({
        success: false,
        error: 'Image not found',
      });
    }

    console.log(
      `Incremented views for image ID: ${id}, new view count: ${updatedImage.views}`
    );

    res.status(200).json({
      success: true,
      message: 'Image view count incremented successfully',
      image: {
        id: updatedImage._id,
        views: updatedImage.views,
      },
    });
  } catch (error) {
    console.error('Error incrementing image views:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Route to get image views by image ID
router.get('/get-image-views/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing image ID',
      });
    }

    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found',
      });
    }

    res.status(200).json({
      success: true,
      views: image.views,
      image: {
        id: image._id,
        views: image.views,
      },
    });
  } catch (error) {
    console.error('Error fetching image views:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

// Route to place a bid
router.post('/place-bid/:imageId', isUserAuthorized, async (req, res) => {
  const { imageId } = req.params;
  const { bidAmount } = req.body;
  const userId = req.user._id;

  try {
    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid image ID' });
    }

    const image = await ImageModel.findById(imageId);
    if (!image) {
      return res
        .status(404)
        .json({ success: false, error: 'Artwork not found' });
    }

    if (bidAmount <= image.currentBid) {
      return res
        .status(400)
        .json({ success: false, error: 'Bid must be higher than current bid' });
    }

    if (!image.bids) {
      image.bids = [];
    }

    const existingBidIndex = image.bids.findIndex(
      (bid) => bid.userId.toString() === userId.toString()
    );

    if (existingBidIndex !== -1) {
      image.bids[existingBidIndex].amount = bidAmount;
    } else {
      image.bids.push({ userId, amount: bidAmount });
    }

    await ImageModel.findByIdAndUpdate(imageId, {
      $set: { currentBid: bidAmount, highestBidder: userId },
      $push: { bids: { userId, amount: bidAmount } },
    });

    res.status(200).json({
      success: true,
      message: 'Bid placed successfully',
      newBid: bidAmount,
    });
  } catch (error) {
    console.error('Error placing bid:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Route to finalize a purchase
router.post('/image/:imageId/buy', isUserAuthorized, async (req, res) => {
  try {
    const { imageId } = req.params;
    const userId = req.user._id; // Buyer

    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ success: false, error: 'Invalid image ID' });
    }

    const image = await ImageModel.findById(imageId);
    if (!image) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    image.stage = IMAGE_STAGE.SOLD;
    image.highestBidder = userId;
    await image.save();

    await UserModel.updateOne(
      { _id: userId },
      { $addToSet: { boughtImages: imageId } }
    );

    res.status(200).json({
      success: true,
      message: 'Image purchased successfully',
    });
  } catch (error) {
    console.error('Error finalizing purchase:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to get the current highest bid for an image
router.get('/current-bid/:imageId', isUserAuthorized, async (req, res) => {
  const { imageId } = req.params;
  const userId = req.user._id;

  try {
    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid image ID' });
    }

    const image = await ImageModel.findById(imageId);
    if (!image) {
      return res
        .status(404)
        .json({ success: false, error: 'Artwork not found' });
    }

    const userBid = image.bids.find(
      (bid) => bid.userId.toString() === userId.toString()
    );

    res.status(200).json({
      success: true,
      currentBid: image.currentBid,
      myBid: userBid ? userBid.amount : 0,
    });
  } catch (error) {
    console.error('Error fetching current bid:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Route to like/unlike an image
router.post('/image/:id/like', isUserAuthorized, async (req, res) => {
  try {
    const imageId = req.params.id;
    const userId = req.user._id;

    const image = await ImageModel.findById(imageId).select('likes');
    const user = await UserModel.findById(userId).select('likedImages');

    if (!image || !user) {
      return res.status(404).json({ success: false, error: 'Image or user not found' });
    }

    let hasLiked = image.likes.includes(userId);

    if (hasLiked) {
      await ImageModel.updateOne(
        { _id: imageId },
        { $pull: { likes: userId } }
      );

      await UserModel.updateOne(
        { _id: userId },
        { $pull: { likedImages: imageId } }
      );
    } else {
      await ImageModel.updateOne(
        { _id: imageId },
        { $addToSet: { likes: userId } }
      );

      await UserModel.updateOne(
        { _id: userId },
        { $addToSet: { likedImages: imageId } }
      );
    }

    const updatedImage = await ImageModel.findById(imageId).select('likes');

    res.status(200).json({
      success: true,
      likesCount: updatedImage.likes.length,
      hasLiked: !hasLiked,
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to get likes for an image
router.get('/image/:id/likes', isUserAuthorized, async (request, response) => {
  try {
    const userId = request.user._id;
    const imageId = request.params.id;

    const image = await ImageModel.findById(imageId);

    if (!image) {
      return response
        .status(404)
        .json({ success: false, error: 'Image not found' });
    }

    response.status(200).json({
      success: true,
      likesCount: image.likes.length,
      hasLiked: image.likes.includes(userId),
    });
  } catch (error) {
    console.error('Error fetching likes:', error);
    response
      .status(500)
      .json({ success: false, error: 'Internal Server Error' });
  }
});

// Route to review and update the stage of an image
router.patch("/image/:id/review", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;
    const userId = req.user._id;

    if (!Object.values(IMAGE_STAGE).includes(stage)) {
      return res.status(400).json({
        success: false,
        error: "Invalid stage. Allowed values: review, approved, rejected",
      });
    }

    const updatedImage = await ImageModel.findByIdAndUpdate(
      id,
      { stage, reviewedBy: userId, reviewedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!updatedImage) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }

    return res.status(200).json({
      success: true,
      message: `Image ${stage === "approved" ? "approved" : "rejected"} successfully`,
      image: updatedImage,
    });
  } catch (error) {
    console.error("Error updating image stage:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Exporting the router as the default export
export default router;
