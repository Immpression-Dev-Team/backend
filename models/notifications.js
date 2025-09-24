// models/notifications.js
import mongoose from "mongoose";
const { Schema, Types } = mongoose;
import UserModel from "./users.js";
import sendEmail from "../services/email.js";

/**
 * Notification Types
 */
export const NOTIFICATION_TYPE = {
  DELIVERY_DETAILS_SUBMITTED: "delivery_details_submitted",
  ORDER_PAID: "order_paid",
  ORDER_NEEDS_SHIPPING: "order_needs_shipping",
  ORDER_SHIPPED: "order_shipped",
  ORDER_OUT_FOR_DELIVERY: "order_out_for_delivery", // ✅ add this (referenced in your poller)
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

/** ---------- email helpers ---------- */
function buildNotificationEmailHTML({ appName, recipientName, title, message, cta }) {
  const year = new Date().getFullYear();
  const safeName = recipientName || "there";
  const button = cta?.url && cta?.label
    ? `<div style="text-align:center;margin:24px 0">
         <a href="${cta.url}"
            style="display:inline-block;padding:12px 18px;border-radius:8px;background:#1a73e8;color:#fff;text-decoration:none;font-weight:600">
            ${cta.label}
         </a>
       </div>`
    : "";

  return `<!doctype html>
  <html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
  <body style="margin:0;background:#f7f7f7;font-family:Arial,Helvetica,sans-serif;color:#333">
    <div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden">
      <div style="padding:20px 24px;border-bottom:1px solid #eee;text-align:center">
        <h1 style="margin:0;font-size:20px">${appName}</h1>
      </div>
      <div style="padding:22px 24px">
        <p style="margin-top:0">Hi ${safeName},</p>
        ${title ? `<h2 style="font-size:18px;margin:12px 0">${title}</h2>` : ""}
        <p style="line-height:1.5;margin:12px 0">${message}</p>
        ${button}
        <p style="color:#777;font-size:12px;margin-top:28px">If you didn’t expect this email, you can ignore it.</p>
      </div>
      <div style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;color:#888;text-align:center;font-size:12px">
        © ${year} ${appName}. All rights reserved.
      </div>
    </div>
  </body>
  </html>`;
}

function notificationEmailMeta(doc) {
  const base = process.env.APP_WEB_BASE_URL || "https://immpression.com";
  const art = doc?.data?.artName ? `“${doc.data.artName}”` : "your order";
  const orderUrl = doc.orderId ? `${base}/orders/${doc.orderId}` : null;

  switch (doc.type) {
    case NOTIFICATION_TYPE.DELIVERY_DETAILS_SUBMITTED:
      return { subject: "New order started", message: doc.message, cta: orderUrl && { label: "View order", url: orderUrl } };
    case NOTIFICATION_TYPE.ORDER_PAID:
      return { subject: "Payment received", message: doc.message, cta: orderUrl && { label: "Prepare shipment", url: orderUrl } };
    case NOTIFICATION_TYPE.ORDER_NEEDS_SHIPPING:
      return { subject: "Action needed: ship order", message: doc.message, cta: orderUrl && { label: "Add tracking", url: orderUrl } };
    case NOTIFICATION_TYPE.ORDER_SHIPPED:
      return { subject: "Your order has shipped", message: doc.message, cta: orderUrl && { label: "Track package", url: orderUrl } };
    case NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY:
      return { subject: "Out for delivery", message: doc.message, cta: orderUrl && { label: "Track delivery", url: orderUrl } };
    case NOTIFICATION_TYPE.ORDER_DELIVERED:
      return { subject: "Delivered", message: doc.message, cta: orderUrl && { label: "View order", url: orderUrl } };
    case NOTIFICATION_TYPE.PROFILE_VIEW:
      return { subject: "Someone viewed your profile", message: doc.message };
    case NOTIFICATION_TYPE.LIKE_RECEIVED:
      return { subject: "You received a like", message: doc.message };
    case NOTIFICATION_TYPE.IMAGE_APPROVED:
      return { subject: "Your image was approved", message: doc.message };
    case NOTIFICATION_TYPE.IMAGE_REJECTED:
      return { subject: "Your image was rejected", message: doc.message };
    default:
      return { subject: doc.title || "Notification", message: doc.message };
  }
}

/** Post-save hook → send email */
NotificationSchema.post("save", async function (doc) {
  try {
    const recipient = await UserModel.findById(doc.recipientUserId).lean();
    if (!recipient?.email) return;

    const appName = process.env.APP_NAME || "Immpression";
    const meta = notificationEmailMeta(doc);

    const html = buildNotificationEmailHTML({
      appName,
      recipientName: recipient.name || recipient.userName || (recipient.email?.split("@")[0]),
      title: doc.title,
      message: meta.message,
      cta: meta.cta,
    });

    await sendEmail(recipient.email, meta.subject, html);
  } catch (e) {
    console.error("Notification email send failed:", e?.message || e);
  }
});

/** Model export */
const Notification =
  mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);

export default Notification;
