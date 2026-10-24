import mongoose from "mongoose";

const adminSettingsSchema = new mongoose.Schema(
  {
    // Singleton — only one document ever exists
    _singleton: { type: Boolean, default: true, unique: true },

    notifications: {
      newSignup:         { type: Boolean, default: false },
      newPendingArtwork: { type: Boolean, default: false },
      newReport:         { type: Boolean, default: false },
    },

    // Admin emails that receive notifications
    notificationEmails: [{ type: String, trim: true, lowercase: true }],

    // On/off switches for ads on the public website: a master switch per
    // network plus one per placement. The ad code itself lives in the
    // web-app (src/constants/ads.js); placement ids must match it and
    // AD_PLACEMENTS in routes/adsRoutes/adsRoutes.js.
    ads: {
      adsterra: {
        enabled: { type: Boolean, default: false },
        placements: {
          marketplaceRailTop: {
            enabled: { type: Boolean, default: false },
          },
        },
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model("AdminSettings", adminSettingsSchema);
