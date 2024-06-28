// Import the Mongoose library for MongoDB
import mongoose from "mongoose";

// Destructure the Schema constructor from mongoose
const { Schema } = mongoose;

// Define the ImageSchema using the Schema constructor
const ImageSchema = new Schema(
  {
    // Define the userId field with type String and validation
    userId: {
      type: String,
      // userId is required with a custom error message
      required: [true, "UserId is required"],
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
    // Define the imageURL field with type String, uniqueness, and validation
    imageURL: {
      type: String,
      // imageURL must be unique
      unique: true,
      // imageURL is required with a custom error message
      required: [true, "Image URL is required"],
      validate: {
        validator: function(value) {
          // Regular expression to validate URL format
          const urlRegex = /^(http|https):\/\/[^ "]+$/;
          return urlRegex.test(value);
        },
        // Custom error message for invalid URL format
        message: "Invalid URL",
      },
    },
    // Define the price field with type String and validation
    price: {
      type: String,
      // price is required with a custom error message
      required: [true, "Price is required"],
      // price field will not be selected by default in queries
      select: false,
      // Minimum value of 1 with a custom error message
      min: [1, "Price should be greater than $0.99"],
      // Maximum value of 1,000,000 with a custom error message
      max: [1000000, "Price should be less than $1,000,000"],
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
    viewCount: {
      type: Number,
      // Default value for viewCount is 0
      default: 0,
      // viewCount field will not be selected by default in queries
      select: false,
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
const ImageModel = mongoose.models.ImageModel || mongoose.model("Image", ImageSchema);

// Export the Image model
export default ImageModel;
