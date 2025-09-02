import mongoose from "mongoose";
const { Schema } = mongoose;

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

// Normalize carrier codes from AfterShip to your TitleCase enum
const toTitleCaseCarrier = (val) => {
  if (!val) return val;
  const map = { usps: "USPS", ups: "UPS", fedex: "FedEx", dhl: "DHL",
    canadapost: "CanadaPost", royalmail: "RoyalMail",
    australiapost: "AustraliaPost", laposte: "LaPoste", deutschepost: "DeutschePost"
  };
  const key = String(val).replace(/\s+/g, "").toLowerCase();
  return map[key] || val; // fall back to original (will fail enum if unsupported)
};

const TrackingEventSchema = new Schema(
  {
    status: String,
    message: String,
    datetime: Date,
    location: String,
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
    deliveredAt: { type: Date },        // ⬅ add

    // Verification signal: becomes true on first carrier scan/webhook event
    verified: { type: Boolean, default: false }, // ⬅ add

    // AfterShip specific
    aftershipTrackingId: { type: String, sparse: true },
    trackingDetails: {
      type: Schema.Types.Mixed,
      default: {},
      select: false, // optional: avoid heavy payloads on every query
    },

    // Optional: where the seller actually shipped (if needed)
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
  },
  { _id: false }
);

const OrderSchema = new Schema(
  {
    imageId: { type: Schema.Types.ObjectId, ref: "Image", required: true },
    artName: { type: String, required: true },
    artistName: { type: String },

    // ⬇ NEW: enforce seller-only submission checks in your route
    artistUserId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // ⬅ add

    artistStripeId: { type: String, required: true },
    price: { type: Number, required: true },

    userAccountName: { type: String, required: true },
    deliveryDetails: {
      name: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zipCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

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

// Helpful compound indexes
OrderSchema.index({ "shipping.trackingNumber": 1, _id: 1 }); // lookups by tracking → order
OrderSchema.index({ "shipping.aftershipTrackingId": 1 });      // webhooks → order fast

const OrderModel = mongoose.models.Order || mongoose.model("Order", OrderSchema);
export default OrderModel;
export { ShippingSchema, TrackingEventSchema };
