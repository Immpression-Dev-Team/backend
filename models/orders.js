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
  RETURNED: "returned"
};

const SHIPMENT_STATUS_ENUM = {
  values: Object.values(SHIPMENT_STATUS),
  message: 'Shipment status should be one of the predefined values'
}

const OrderSchema = new Schema(
  {
    imageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      required: true,
    },
    // Name of the artwork
    artName: {
      type: String,
      required: true,
    },
    // Artist name (optional)
    artistName: {
      type: String,
    },
    // Artist's connected Stripe account ID (REQUIRED for Stripe Connect)
    artistStripeId: {
      type: String,
      required: true,
    },
    // Price of the artwork in USD
    price: {
      type: Number,
      required: true,
    },
    // User account name
    userAccountName: {
      type: String,
      required: true,
    },
    // Delivery details
    deliveryDetails: {
      name: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zipCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    // Reference to user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Payment status
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    // Stripe payment intent ID
    paymentIntentId: {
      type: String,
    },
    // Payment timestamps
    paidAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
    // Payment failure reason
    failureReason: {
      type: String,
    },
    // Transaction ID
    transactionId: {
      type: String,
    },
        // Shipping and tracking fields
    shipping: {
      trackingNumber: {
        type: String,
        trim: true,
        uppercase: true
      },
      carrier: {
        type: String,
        enum: {
          values: [
            'USPS', 'UPS', 'FedEx', 'DHL', 'CanadaPost', 
            'RoyalMail', 'AustraliaPost', 'LaPoste', 'DeutschePost'
          ],
          message: 'Carrier must be a supported shipping provider'
        }
      },
      shipmentStatus: {
        type: String,
        enum: SHIPMENT_STATUS_ENUM,
        default: SHIPMENT_STATUS.PENDING
      },
      shippedAt: { type: Date },
      estimatedDelivery: { type: Date },
      
      // EasyPost specific fields
      easypostTrackerId: { type: String }, // EasyPost tracker ID
      trackingDetails: {
        type: mongoose.Schema.Types.Mixed, // Store full EasyPost tracking response
        default: {}
      },
      
      // Shipping address
      shippingAddress: {
        name: { type: String },
        street1: { type: String },
        street2: { type: String },
        city: { type: String },
        state: { type: String },
        zip: { type: String },
        country: { type: String, default: 'US' }
      },
      
      // Additional tracking info
      trackingEvents: [{
        status: String,
        message: String,
        datetime: Date,
        location: String
      }]
    }
  },
  { timestamps: true }
);

const OrderModel =
  mongoose.models.Order || mongoose.model("Order", OrderSchema);

export default OrderModel;
