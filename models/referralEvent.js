import mongoose from "mongoose";

export const REFERRAL_EVENT_TYPE = Object.freeze({
  PAGE_VIEW: "PAGE_VIEW",
  ROLE_SELECTED: "ROLE_SELECTED",
  APP_STORE_CLICK: "APP_STORE_CLICK",
  PLAY_STORE_CLICK: "PLAY_STORE_CLICK",
});

export const REFERRAL_ROLE = Object.freeze({
  ARTIST: "ARTIST",
  ART_LOVER: "ART_LOVER",
  BOTH: "BOTH",
});

const referralEventSchema = new mongoose.Schema(
  {
    referral: { type: mongoose.Schema.Types.ObjectId, ref: "Referral", required: true, index: true },
    type: { type: String, enum: Object.values(REFERRAL_EVENT_TYPE), required: true },
    role: { type: String, enum: Object.values(REFERRAL_ROLE) },
    platform: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model("ReferralEvent", referralEventSchema);
