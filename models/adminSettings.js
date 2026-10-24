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

    // Ad networks shown on the public website. Each network has a master
    // switch plus per-placement switches/keys; placement ids must match
    // AD_PLACEMENTS in routes/adsRoutes/adsRoutes.js and the web-app.
    ads: {
      adsterra: {
        enabled: { type: Boolean, default: false },
        placements: {
          marketplaceRailTop: {
            enabled: { type: Boolean, default: false },
            key: { type: String, trim: true, default: "" },
            // Script URL from the Adsterra code (their ad domains rotate).
            src: { type: String, trim: true, default: "" },
          },
        },
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model("AdminSettings", adminSettingsSchema);
