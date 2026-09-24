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
  message:
    'Category should be one of the following: [Paintings, Photography, Graphic Design, Illustrations, Sculptures, Woodwork, Graffiti, Stencil]',
};

// Define enum for image review stages
export const IMAGE_STAGE = {
  REVIEW: "review",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const STAGE_ENUM = {
  values: Object.values(IMAGE_STAGE),
  message: "Stage should be one of the following: [review, approved, rejected]",
};

// Define enum for fulfillment type
export const FULFILLMENT_TYPE = {
  SELLER: "seller",
  PRINT_ON_DEMAND: "print_on_demand",
};

const FULFILLMENT_TYPE_ENUM = {
  values: Object.values(FULFILLMENT_TYPE),
  message: "fulfillmentType should be one of the following: [seller, print_on_demand]",
};

// Define enum for print-on-demand setup status
export const PRINT_ON_DEMAND_STATUS = {
  PENDING_SETUP: "pending_setup",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
};

const POD_STATUS_ENUM = {
  values: Object.values(PRINT_ON_DEMAND_STATUS),
  message: "printOnDemandStatus should be one of the following: [pending_setup, available, unavailable]",
};

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
      required: function () {
        return this.stage === IMAGE_STAGE.APPROVED;
      },
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

    // Expanded dimensions with length.
    // Only required for seller-fulfilled artwork — Print on Demand artwork
    // has no physical piece for the artist to measure.
    dimensions: {
      height: {
        type: Number, // in inches or cm
        required: function () { return this.fulfillmentType !== FULFILLMENT_TYPE.PRINT_ON_DEMAND; },
      },
      width: {
        type: Number,
        required: function () { return this.fulfillmentType !== FULFILLMENT_TYPE.PRINT_ON_DEMAND; },
      },
      length: {
        type: Number,
        required: function () { return this.fulfillmentType !== FULFILLMENT_TYPE.PRINT_ON_DEMAND; },
      },
    },

    // New top-level field for weight. Same seller-only requirement as dimensions.
    weight: {
      type: Number, // in lbs or kg
      required: function () { return this.fulfillmentType !== FULFILLMENT_TYPE.PRINT_ON_DEMAND; },
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

    // Review system fields
    stage: {
      type: String,
      enum: STAGE_ENUM,
      default: IMAGE_STAGE.REVIEW,
    },
    reviewedByEmail: { type: String },
    reviewedAt: { type: Date },
    rejectionMessage: {
      type: String,
      default: "",
    },
    soldStatus: {
      type: String,
      enum: ["unsold", "sold"],
      default: "unsold",
    },

    // How this artwork gets to the buyer: seller ships it themselves, or
    // Immpression prints and ships it (Print on Demand).
    fulfillmentType: {
      type: String,
      enum: FULFILLMENT_TYPE_ENUM,
      default: FULFILLMENT_TYPE.SELLER,
    },
    printOnDemandStatus: {
      type: String,
      enum: POD_STATUS_ENUM,
      default: null,
    },
    // Best-effort print-quality metadata, only meaningful when
    // fulfillmentType === "print_on_demand". Not validated/enforced yet.
    printSourceMeta: {
      width: { type: Number },
      height: { type: Number },
      format: { type: String },
      imageUrl: { type: String },
      originalImageUrl: { type: String },
    },
  },
  { timestamps: true }
);

// Create the Image model using the ImageSchema, or retrieve it if it already exists
const ImageModel =
  mongoose.models.ImageModel || mongoose.model("Image", ImageSchema);

export default ImageModel;
