import mongoose from "mongoose";

const featuredArticleSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    url:         { type: String, required: true, trim: true },
    imageUrl:    { type: String, required: true, trim: true },
    publication: { type: String, trim: true, default: "" },
    publishedAt: { type: Date, required: true },
    order:       { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("FeaturedArticle", featuredArticleSchema);
