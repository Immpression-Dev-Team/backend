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
  return map[key] || val;
};

/** ===================== Subdocs ===================== */
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
      set: toTitleCaseCarrier,
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
    verified: { type: Boolean, default: false },
    aftershipTrackingId: { type: String, sparse: true },
    trackingDetails: { type: Schema.Types.Mixed, default: {}, select: false },
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
    pollAttempts: { type: Number, default: 0 },
    nextPollAt: { type: Date, index: true },
    lastPolledAt: { type: Date },
  },
  { _id: false }
);

/** ===================== Order ===================== */
const Money = { type: Number, min: 0, default: 0 }; // cents, integers

const OrderSchema = new Schema(
  {
    imageId: { type: Schema.Types.ObjectId, ref: "Image", required: true },
    artName: { type: String, required: true },
    artistName: { type: String },

    artistUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    artistStripeId: { type: String, required: true },

    /**
     * LEGACY: `price` has been used as base price across the app.
     * We are introducing baseAmount/shippingAmount/taxAmount/totalAmount.
     * For backward-compatibility, we keep `price` and mirror it to baseAmount.
     */
    price: { type: Number, min: 0, required: true }, // cents (legacy base price)

    /** >>> New monetary fields (all cents) <<< */
    baseAmount: { ...Money },     // mirrors `price` for now
    shippingAmount: { ...Money }, // after calculation
    taxAmount: { ...Money },      // after calculation
    totalAmount: { ...Money },    // base + shipping + tax

    userAccountName: { type: String, required: true }, // buyer name at order time

    deliveryDetails: {
      name: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zipCode: { type: String, required: true },
      country: { type: String, required: true },
      // (optional) shippingCost, phone, etc.
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

/** Keep monetary fields in sync & enforce totalAmount */
OrderSchema.pre("save", function (next) {
  // If new fields are missing, seed them from legacy `price`
  if (typeof this.baseAmount !== "number" || this.baseAmount < 0) {
    this.baseAmount = Math.max(0, Number(this.price || 0));
  }
  // Keep legacy `price` mirrored from baseAmount if someone only set the new field
  if (typeof this.price !== "number" || this.price < 0) {
    this.price = Math.max(0, Number(this.baseAmount || 0));
  }

  const b = Math.max(0, Number(this.baseAmount || 0));
  const s = Math.max(0, Number(this.shippingAmount || 0));
  const t = Math.max(0, Number(this.taxAmount || 0));

  this.totalAmount = b + s + t;
  next();
});

/** ===================== Indexes ===================== */
OrderSchema.index({ "shipping.trackingNumber": 1, _id: 1 });
OrderSchema.index({ "shipping.aftershipTrackingId": 1 });
OrderSchema.index({ "shipping.nextPollAt": 1, "shipping.shipmentStatus": 1 });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ artistUserId: 1, createdAt: -1 });

/** ===================== Exports ===================== */
const OrderModel = mongoose.models.Order || mongoose.model("Order", OrderSchema);
export default OrderModel;
export { ShippingSchema, TrackingEventSchema };
