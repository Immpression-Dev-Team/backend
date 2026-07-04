import mongoose from "mongoose";

const financeEntrySchema = new mongoose.Schema(
  {
    type:   { type: String, enum: ["expense", "revenue"], required: true },
    name:   { type: String, required: true, trim: true },
    price:  { type: Number, required: true },
    source: { type: String, required: true, trim: true },
    date:   { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("FinanceEntry", financeEntrySchema);
