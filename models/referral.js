import mongoose from "mongoose";

const referralSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    internalLabel: { type: String, trim: true, default: "" },
    code: { type: String, required: true, unique: true, index: true },
    previousCodes: [{ type: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

export default mongoose.model("Referral", referralSchema);
