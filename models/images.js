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
    // Define the userId field with type String and validation
    userId: { //commented out for testing
      type: String,
      // userId is required with a custom error message
      required: [true, "UserId is required"],
    },
    artistName: {
      type: String,
      required: [true, "artistName is required"],
    },
    // Define the name field with type String and validation
    name: {
      type: String,
      // name is required with a custom error message
      required: [true, "Name is required"],
      // Minimum length of 4 characters with a custom error message
      minLength: [4, "Name should be at least 4 characters"],
      // Maximum length of 30 characters with a custom error message
      maxLength: [30, "Name should be less than 30 characters"],
    },
    // Define the imageFile field with type String, uniqueness, and validation, and
    imageLink: {
      type: String, 
    },
    // Define the price field with type String and validation
    price: {
      type: Number,
      // price is required with a custom error message
      required: [true, "Price is required"],

      // Minimum value of 1 with a custom error message
      min: [1, "Price should be greater than $0.99"],
      // Maximum value of 1,000,000 with a custom error message
      max: [1000000, "Price should be less than $1,000,000"],
      validate: {
        validator: function(value) {
          return 1000000 >= value >= 1;
        },
        message: 'Price must be a positive number from $1 to $1,000,000'
      }
    },
    // Define the description field with type String and validation
    description: {
      type: String,
      // description is required with a custom error message
      required: [true, "Description is required"],
      // Minimum length of 4 characters with a custom error message
      minLength: [4, "Description should be at least 4 characters"],
      // Maximum length of 30 characters with a custom error message
      maxLength: [30, "Description should be less than 30 characters"],
    },
    // Define the viewCount field with type Number and a default value
    views: {
      type: Number,
      // Default value for viewCount is 0
      default: 0,
    },
    // Define the category field with type String (required, can only be one of 8 category strings)
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: CATEGORY_ENUM
    },
    currentBid: {
      type: Number,
      default: 0, // Start at 0
    },
    highestBidder: {
      type: String, // Store the user ID of the highest bidder
      default: null,
    },
  },
  {
    // Add timestamps for createdAt and updatedAt
    timestamps: true,
    // Add version key keeping track of updates
    versionKey: "__v",
  }
);

// Create the Image model using the ImageSchema, or retrieve it if it already exists
const ImageModel =
  mongoose.models.ImageModel || mongoose.model("Image", ImageSchema);

// Export the Image model
export default ImageModel;
