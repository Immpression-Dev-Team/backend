import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const ImageViewSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    imageId: { type: Types.ObjectId, ref: "Image", required: true, index: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ImageViewSchema.index({ userId: 1, imageId: 1 }, { unique: true });

const ImageViewModel =
  mongoose.models.ImageView || mongoose.model("ImageView", ImageViewSchema);

export default ImageViewModel;