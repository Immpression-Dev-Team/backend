// Import the Mongoose library for MongoDB
import mongoose from "mongoose";

// Destructure the Schema constructor from mongoose
const { Schema } = mongoose;

// Define enum for image categories
export const IMAGE_CATEGORY = [
  'paintings',
  'photography',
  'graphic design',
  'illustrations',
  'sculptures',
  'woodwork',
  'graffiti',
  'stencil'
];

const CATEGORY_ENUM = {
  values: IMAGE_CATEGORY,
  message: 'Category should be one of the following: [Paintings, Photography, Graphic Design, Illustrations, Sculptures, Woodwork, Graffiti, Stencil]'
}

// Define the ImageSchema using the Schema constructor
const ImageSchema = new Schema(
  {
    userId: {
      type: String,
      required: [true, "UserId is required"],
    },
    artistName: {
      type: String,
      required: [true, "artistName is required"],
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      minLength: [4, "Name should be at least 4 characters"],
      maxLength: [30, "Name should be less than 30 characters"],
    },
    imageLink: { type: String },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [1, "Price should be greater than $0.99"],
      max: [1000000, "Price should be less than $1,000,000"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      minLength: [4, "Description should be at least 4 characters"],
      maxLength: [30, "Description should be less than 30 characters"],
    },
    views: { type: Number, default: 0 },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: IMAGE_CATEGORY,
    },
    currentBid: { type: Number, default: 0 }, // Ensure there's a currentBid field
    highestBidder: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Track highest bidder
    bids: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        amount: { type: Number, required: true },
      },
    ], // Initialize bids as an array of objects
  },
  { timestamps: true }
);


// Create the Image model using the ImageSchema, or retrieve it if it already exists
const ImageModel =
  mongoose.models.ImageModel || mongoose.model("Image", ImageSchema);

// Export the Image model
export default ImageModel;
