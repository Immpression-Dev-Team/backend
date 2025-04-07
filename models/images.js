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

// Define enum for image review stages
export const IMAGE_STAGE = {
  REVIEW: "review",
  APPROVED: "approved",
  REJECTED: "rejected"
};

const STAGE_ENUM = {
  values: Object.values(IMAGE_STAGE),
  message: 'Stage should be one of the following: [review, approved, rejected]'
}

// Define the ImageSchema using the Schema constructor
const ImageSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
    imageLink: {
      type: String,
      required: function () { return this.stage === IMAGE_STAGE.APPROVED; }
    },
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
      maxLength: [1000, "Description should be less than 1000 characters"],
    },
    views: { type: Number, default: 0 },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: CATEGORY_ENUM,
    },
    currentBid: { type: Number, default: 0 },
    highestBidder: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    bids: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        amount: { type: Number, required: true },
      },
    ],
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dimensions: {
      height: { type: Number, required: true }, // in inches or cm, your choice
      width: { type: Number, required: true },
    },
    isSigned: {
      type: Boolean,
      required: true,
      default: false,
    },
    isFramed: {
      type: Boolean,
      required: true,
      default: false,
    },
    // New fields for review system
    stage: {
      type: String,
      enum: STAGE_ENUM,
      default: IMAGE_STAGE.REVIEW,
    },
    reviewedByEmail: { type: String }, // ✅ Stores the email of the reviewer
    reviewedAt: { type: Date }, // ✅ Stores the timestamp of approval/rejection
  },
  { timestamps: true }
);

// Create the Image model using the ImageSchema, or retrieve it if it already exists
const ImageModel =
  mongoose.models.ImageModel || mongoose.model("Image", ImageSchema);

// Export the Image model
export default ImageModel;
