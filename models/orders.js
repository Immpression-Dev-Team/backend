// models/orders.js
import mongoose from "mongoose";
const { Schema } = mongoose;

/** ===================== Enums ===================== */
export const SHIPMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  SHIPPED: "shipped",
  IN_TRANSIT: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  EXCEPTION: "exception",
  RETURNED: "returned",
};

const SHIPMENT_STATUS_ENUM = {
  values: Object.values(SHIPMENT_STATUS),
  message: "Shipment status should be one of the predefined values",
};

/** Normalize carrier codes/slugs to TitleCase names used in schema enum */
const toTitleCaseCarrier = (val) => {
  if (!val) return val;
  const map = {
    usps: "USPS",
    ups: "UPS",
    fedex: "FedEx",
    dhl: "DHL",
    canadapost: "CanadaPost",
    royalmail: "RoyalMail",
    australiapost: "AustraliaPost",
    laposte: "LaPoste",
    deutschepost: "DeutschePost",
  };
  const key = String(val).replace(/\s+/g, "").toLowerCase();
  return map[key] || val; // fall back to original (will fail enum if unsupported)
};

/** ===================== Subdocs ===================== */
const TrackingEventSchema = new Schema(
  {
    status: String,          // lowercase snapshot of event/tag (e.g., "in transit")
    message: String,         // human-readable line from carrier
    datetime: Date,          // parsed event time if available
    location: String,        // "City, ST, Country"
  },
  { _id: false }
);

const ShippingSchema = new Schema(
  {
    trackingNumber: { type: String, trim: true, uppercase: true, index: true },
    carrier: {
      type: String,
      set: toTitleCaseCarrier, // normalize on write
      enum: {
        values: [
          "USPS",
          "UPS",
          "FedEx",
          "DHL",
          "CanadaPost",
          "RoyalMail",
          "AustraliaPost",
          "LaPoste",
          "DeutschePost",
        ],
        message: "Carrier must be a supported shipping provider",
      },
    },

    shipmentStatus: {
      type: String,
      enum: SHIPMENT_STATUS_ENUM,
      default: SHIPMENT_STATUS.PENDING,
      index: true,
    },

    shippedAt: { type: Date },
    estimatedDelivery: { type: Date },
    deliveredAt: { type: Date },

    // First positive scan/webhook flips this true
    verified: { type: Boolean, default: false },

    // AfterShip integration
    aftershipTrackingId: { type: String, sparse: true },
    trackingDetails: {
      type: Schema.Types.Mixed,
      default: {},
      select: false, // avoid heavy payloads on most queries
    },

    // (Optional) where the seller actually shipped from/to (if you capture it)
    shippingAddress: {
      name: { type: String },
      street1: { type: String },
      street2: { type: String },
      city: { type: String },
      state: { type: String },
      zip: { type: String },
      country: { type: String, default: "US" },
    },

    trackingEvents: [TrackingEventSchema],

    /** -------- Polling fields (for cron-based auto recheck) -------- */
    pollAttempts: { type: Number, default: 0 },
    nextPollAt: { type: Date, index: true },
    lastPolledAt: { type: Date },
  },
  { _id: false }
);

/** ===================== Order ===================== */
const OrderSchema = new Schema(
  {
    imageId: { type: Schema.Types.ObjectId, ref: "Image", required: true },
    artName: { type: String, required: true },
    artistName: { type: String },

    // enforce seller-only submission in routes
    artistUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    artistStripeId: { type: String, required: true },
    price: { type: Number, required: true },

    userAccountName: { type: String, required: true }, // buyer's name at order time

    deliveryDetails: {
      name: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zipCode: { type: String, required: true },
      country: { type: String, required: true },
      // you can add shippingCost, phone, etc. if you already store them
    },

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // buyer

    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    paymentIntentId: { type: String },
    paidAt: { type: Date },
    refundedAt: { type: Date },
    failureReason: { type: String },
    transactionId: { type: String },

    shipping: { type: ShippingSchema, default: {} },
  },
  { timestamps: true }
);

/** ===================== Indexes ===================== */
// lookups by tracking → order (also keeps index selective/stable)
OrderSchema.index({ "shipping.trackingNumber": 1, _id: 1 });

// AfterShip webhooks → order fast
OrderSchema.index({ "shipping.aftershipTrackingId": 1 });

// efficient “due for polling” scans
OrderSchema.index({ "shipping.nextPollAt": 1, "shipping.shipmentStatus": 1 });

// (nice-to-haves for dashboards)
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ artistUserId: 1, createdAt: -1 });

/** ===================== Exports ===================== */
const OrderModel = mongoose.models.Order || mongoose.model("Order", OrderSchema);
export default OrderModel;
export { ShippingSchema, TrackingEventSchema };
