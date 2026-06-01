import mongoose from "mongoose";

const artworkRefSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["met", "chicago"], required: true },
    id: { type: String, required: true },
  },
  { _id: false }
);

// Singleton document — only one record ever exists (key: "default").
const featuredPublicArtSchema = new mongoose.Schema({
  key: { type: String, default: "default", unique: true },
  artworks: {
    type: [artworkRefSchema],
    validate: {
      validator: (arr) => arr.length <= 20,
      message: "Cannot feature more than 20 artworks.",
    },
    default: [],
  },
  updatedBy: { type: String, default: null },
});

export default mongoose.model("FeaturedPublicArt", featuredPublicArtSchema);
