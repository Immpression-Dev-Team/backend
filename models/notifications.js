// models/notification.js
import mongoose from "mongoose";
const { Schema, Types } = mongoose;

/**
 * Notification Types
 * - delivery_details_submitted: buyer completed Delivery Details
 * - order_paid: payment confirmed (Stripe)
 * - order_shipped: seller entered tracking number
 * - order_delivered: carrier confirms delivery
 * - profile_view, like_received, image_approved, image_rejected: other app events
 */
export const NOTIFICATION_TYPE = {
  DELIVERY_DETAILS_SUBMITTED: "delivery_details_submitted",
  ORDER_PAID: "order_paid",
  ORDER_NEEDS_SHIPPING: "order_needs_shipping",
  ORDER_SHIPPED: "order_shipped",
  ORDER_DELIVERED: "order_delivered",
  PROFILE_VIEW: "profile_view",
  LIKE_RECEIVED: "like_received",
  IMAGE_APPROVED: "image_approved",
  IMAGE_REJECTED: "image_rejected",
};

const TYPE_ENUM = {
  values: Object.values(NOTIFICATION_TYPE),
  message: "Unsupported notification type",
};

/**
 * Schema definition
 */
const NotificationSchema = new Schema(
  {
    // Who receives this notification
    recipientUserId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // (Optional) Who triggered it
    actorUserId: { type: Types.ObjectId, ref: "User" },

    // What happened
    type: { type: String, enum: TYPE_ENUM, required: true },

    // Display content
    title: { type: String, default: "" },
    message: { type: String, required: true },

    // Linkage for deep-linking
    orderId: { type: Types.ObjectId, ref: "Order" },
    imageId: { type: Types.ObjectId, ref: "Image" },

    // Quick-render payload
    data: {
      artName: String,
      artistName: String,
      price: Number,
      imageLink: String,
    },

    // Read state
    readAt: { type: Date, default: null }, // null = unread
  },
  { timestamps: true }
);

/**
 * Virtuals, Indexes, Transform
 */
NotificationSchema.virtual("isRead").get(function () {
  return !!this.readAt;
});

NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });
NotificationSchema.index({ recipientUserId: 1, readAt: 1 });

NotificationSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

/**
 * Static helpers
 */
NotificationSchema.statics.createForDeliveryDetails = async function (order) {
  const payload = {
    recipientUserId: order.artistUserId, // notify seller
    actorUserId: order.userId,           // buyer
    type: NOTIFICATION_TYPE.DELIVERY_DETAILS_SUBMITTED,
    title: "New order started",
    message: `A buyer just submitted delivery details for “${order.artName}”.`,
    orderId: order._id,
    imageId: order.imageId,
    data: {
      artName: order.artName,
      artistName: order.artistName,
      price: order.price,
      imageLink: order?.imageLink,
    },
  };
  return this.create(payload);
};

/**
 * Model export
 */
const NotificationModel =
  mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);

export default NotificationModel;
