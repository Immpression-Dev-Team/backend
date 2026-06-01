import mongoose from "mongoose";

// Full artwork object stored directly — no re-fetching from external APIs needed.
const artworkSchema = new mongoose.Schema(
  {
    id:          { type: String, required: true },
    source:      { type: String, enum: ["met", "chicago", "cleveland", "wikimedia", "rijksmuseum"], required: true },
    title:       { type: String, default: "Untitled" },
    artist:      { type: String, default: "Unknown Artist" },
    year:        { type: String, default: null },
    medium:      { type: String, default: null },
    dimensions:  { type: String, default: null },
    imageUrl:    { type: String, default: null },
    thumbnailUrl:{ type: String, default: null },
    description: { type: String, default: null },
    department:  { type: String, default: null },
    creditLine:  { type: String, default: null },
    sourceUrl:   { type: String, default: null },
  },
  { _id: false }
);

// Singleton document — only one record ever exists (key: "default").
const featuredPublicArtSchema = new mongoose.Schema({
  key: { type: String, default: "default", unique: true },
  artworks: {
    type: [artworkSchema],
    validate: {
      validator: (arr) => arr.length <= 20,
      message: "Cannot feature more than 20 artworks.",
    },
    default: [],
  },
  updatedBy: { type: String, default: null },
});

export default mongoose.model("FeaturedPublicArt", featuredPublicArtSchema);
