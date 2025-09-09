import express from "express";
import OrderModel, { SHIPMENT_STATUS } from "../../models/orders.js";
import ImageModel from "../../models/images.js";
import UserModel from "../../models/users.js";
import { isUserAuthorized, isAdminAuthorized } from "../../utils/authUtils.js";
import axios from 'axios';
import Notification, { NOTIFICATION_TYPE } from "../../models/notifications.js";

import Stripe from "stripe";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();
import jwt from "jsonwebtoken";

// Map AfterShip statuses → your SHIPMENT_STATUS enum
const mapStatus = (s) => {
  switch ((s || "").toLowerCase()) {
    case "pending":
    case "info_received":
    case "inforeceived":
    case "pre_transit": return SHIPMENT_STATUS.SHIPPED;
    case "in_transit": return SHIPMENT_STATUS.IN_TRANSIT;
    case "out_for_delivery": return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
    case "delivered": return SHIPMENT_STATUS.DELIVERED;
    case "available_for_pickup":
    case "exception":
    case "failed_attempt":
    case "return_to_sender": return SHIPMENT_STATUS.EXCEPTION;
    default: return SHIPMENT_STATUS.SHIPPED;
  }
};

function getAuthToken(req) {
  const bearer = req.headers.authorization?.split(" ")[1];
  return bearer || req.cookies?.["auth-token"] || null;
}

// Normalize common slugs (your schema stores TitleCase carriers)
const toTitleCaseCarrier = (slugOrName) => {
  const s = String(slugOrName || "").toLowerCase();
  if (s.includes("usps")) return "USPS";
  if (s.includes("ups")) return "UPS";
  if (s.includes("fedex")) return "FedEx";
  if (s.includes("dhl")) return "DHL";
  return slugOrName || "USPS";
};

// ===== UPS Direct Tracking (no AfterShip) =====

// ---- UPS test-number helpers (put near other UPS helpers) ----

// Public UPS demo numbers (or add your own)
const UPS_TEST_NUMBERS = new Set([
  "1Z12345E0291980793",
  "1Z12345E1512345676",
  "1Z12345E6615272234",
  "1Z12345E0205271688",
  "1Z12345E1392654435",
  "1Z12345E6892410846",
]);

function isTestTrackingNumber(tn) {
  const s = String(tn || "").toUpperCase().replace(/\s+/g, "");
  return UPS_TEST_NUMBERS.has(s);
}

function formatYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`; // UPS YYYYMMDD
}

function buildMockUpsTracking(tn) {
  const now = new Date();
  const tMinus = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    trackResponse: {
      shipment: [{
        package: [{
          trackingNumber: tn,
          currentStatus: { code: "I", description: "In Transit" },
          activity: [
            {
              date: formatYMD(tMinus(3)),
              time: "083000",
              status: { description: "Origin Scan" },
              activityLocation: { address: { city: "New York", stateProvince: "NY", country: "US" } }
            },
            {
              date: formatYMD(tMinus(1)),
              time: "104500",
              status: { description: "Departed UPS Facility" },
              activityLocation: { address: { city: "Secaucus", stateProvince: "NJ", country: "US" } }
            },
            {
              date: formatYMD(now),
              time: "071500",
              status: { description: "In Transit" },
              activityLocation: { address: { city: "Philadelphia", stateProvince: "PA", country: "US" } }
            }
          ]
        }]
      }]
    }
  };
}


// Choose base by env
const upsBase = () =>
  (process.env.UPS_ENV || "cie").toLowerCase() === "prod"
    ? "https://onlinetools.ups.com"
    : "https://wwwcie.ups.com";

// Token cache
let UPS_TOKEN = null;
let UPS_TOKEN_EXP = 0;

// Get OAuth token (client credentials), caches until ~60s before expiry
async function getUpsToken() {
  const now = Math.floor(Date.now() / 1000);
  if (UPS_TOKEN && UPS_TOKEN_EXP - 60 > now) return UPS_TOKEN;

  const url = `${upsBase()}/security/v1/oauth/token`;
  const auth = Buffer.from(
    `${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`
  ).toString("base64");

  // IMPORTANT: include scope=tracking
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "tracking",
  }).toString();

  let resp;
  try {
    resp = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      validateStatus: () => true,
    });
  } catch (e) {
    console.error("UPS OAuth network error:", e?.message || e);
    throw new Error("UPS OAuth request failed");
  }

  if (resp.status !== 200) {
    console.error("UPS OAuth error:", {
      status: resp.status,
      data: resp.data,
    });
    throw new Error(
      resp.data?.error_description ||
      resp.data?.error ||
      "UPS OAuth rejected credentials"
    );
  }

  UPS_TOKEN = resp.data?.access_token;
  const expiresIn = Number(resp.data?.expires_in || 0);
  UPS_TOKEN_EXP = Math.floor(Date.now() / 1000) + (expiresIn || 1800);

  return UPS_TOKEN;
}

// ---- add this helper near your UPS helpers ----
function parseUpsDate(ymd, hms) {
  const d = String(ymd || "").replace(/\D/g, "");
  if (d.length !== 8) return undefined;

  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));   // 01..12
  const day = Number(d.slice(6, 8)); // 01..31

  let hh = 0, mm = 0, ss = 0;
  const t = String(hms || "").replace(/\D/g, "");
  if (t.length >= 2) hh = Number(t.slice(0, 2));
  if (t.length >= 4) mm = Number(t.slice(2, 4));
  if (t.length >= 6) ss = Number(t.slice(4, 6));

  const jsDate = new Date(Date.UTC(y, m - 1, day, hh, mm, ss));
  return isNaN(jsDate.getTime()) ? undefined : jsDate;
}

// Map UPS status → your enum
function mapUpsStatus(upsStatusObj = {}) {
  // UPS response often has currentStatus: { code, description }
  const code = String(upsStatusObj.code || "").toUpperCase();
  const desc = String(upsStatusObj.description || "").toLowerCase();

  // Try code first, then fallback on description keywords
  if (code === "D" || /delivered/.test(desc)) return SHIPMENT_STATUS.DELIVERED;
  if (code === "O" || /out for delivery/.test(desc)) return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
  if (code === "I" || /in transit|arrived|departed|origin scan|destination scan/.test(desc))
    return SHIPMENT_STATUS.IN_TRANSIT;
  if (/exception|failed attempt|return to sender|hold/.test(desc))
    return SHIPMENT_STATUS.EXCEPTION;

  // Pre-transit / label created
  if (/label created|information received|pre[- ]?transit|order processed/.test(desc))
    return SHIPMENT_STATUS.SHIPPED;

  return SHIPMENT_STATUS.SHIPPED;
}

// Fetch details from UPS Tracking API
async function trackWithUPS(inquiryNumber) {
  const token = await getUpsToken();
  const transId = `${Date.now()}`;
  const transactionSrc = process.env.UPS_TRANSACTION_SRC || "immpression";

  const url = `${upsBase()}/api/track/v1/details/${encodeURIComponent(inquiryNumber)}`;
  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      transId,
      transactionSrc,
      Accept: "application/json",
    },
    params: { locale: "en_US", returnSignature: "false" },
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    console.error("UPS Track error:", { status: resp.status, data: resp.data });
    const msg =
      resp.data?.response?.errors?.[0]?.message ||
      resp.data?.response?.errors?.[0]?.code ||
      resp.statusText ||
      "UPS tracking failed";
    const e = new Error(msg);
    e.status = resp.status;
    throw e;
  }

  return resp.data;
}

router.get("/orderDetails/:id", async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }
    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

router.post("/order", isUserAuthorized, async (req, res) => {
  try {
    const { imageId, artName, artistName, price, imageLink, deliveryDetails } = req.body;

    if (!imageId || !artName || !artistName || !price || !deliveryDetails) {
      return res.status(400).json({ success: false, error: "Missing required order fields." });
    }

    // 🔎 Get the image & seller (artist)
    const image = await ImageModel.findById(imageId).lean();
    if (!image) {
      return res.status(404).json({ success: false, error: "Image not found." });
    }

    // Assuming the image doc has the owner at image.userId (change if yours is different)
    const artistUserId = image.userId;
    if (!artistUserId) {
      return res.status(400).json({ success: false, error: "Image has no associated artist." });
    }

    // Get artist’s Stripe connect account (if you store it on the user)
    const artist = await UserModel.findById(artistUserId).lean();
    if (!artist || !artist.stripeAccountId) {
      return res.status(400).json({ success: false, error: "Artist not connected to Stripe." });
    }

    const newOrder = new OrderModel({
      imageId,
      artName,
      artistName,
      price,
      imageLink,
      deliveryDetails,
      userAccountName: req.user.name,
      userId: req.user._id,

      // ✅ these two fields satisfy your schema validation
      artistUserId,                      // required in your schema
      artistStripeId: artist.stripeAccountId,

      status: "pending",
    });

    await newOrder.save();

    // Fire notification to the seller (artist)
    Notification.create({
      recipientUserId: artistUserId,     // seller
      actorUserId: req.user._id,         // buyer
      type: NOTIFICATION_TYPE.DELIVERY_DETAILS_SUBMITTED,
      title: "New order started",
      message: `A buyer submitted delivery details for “${artName}”.`,
      orderId: newOrder._id,
      imageId: imageId,
      data: { artName, artistName, price, imageLink },
    }).catch(err => console.error("Notif create error:", err));

    res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order: newOrder,
      orderId: newOrder._id,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});


router.post("/calculate-tax", async (req, res) => {
  try {
    const { amount, currency, address } = req.body;

    // Create a tax calculation
    const calculation = await stripe.tax.calculations.create({
      currency: currency,
      line_items: [
        {
          amount: amount,
          reference: "artwork-purchase",
        },
      ],
      customer_details: {
        address: {
          line1: address.line1,
          city: address.city,
          state: address.state,
          postal_code: address.postal_code,
          country: address.country,
        },
        address_source: "billing",
      },
    });

    res.json({
      taxAmount: calculation.tax_breakdown[0].amount,
      taxRate: calculation.tax_breakdown[0].rate,
      totalAmount: calculation.amount_total,
    });
  } catch (error) {
    console.error("Tax calculation error:", error);
    res.status(500).json({ error: "Tax calculation failed" });
  }
});

router.post("/create-payment-intent", async (req, res) => {
  try {
    const { orderId, price } = req.body;

    // if (!orderId) {
    //   return res.status(400).json({ error: "Missing orderId" });
    // }

    // const order = await OrderModel.findById(orderId);
    // if (!order) {
    //   return res.status(404).json({ error: "Order not found" });
    // }

    // if (!order.price || !order.artistStripeId) {
    //   return res
    //     .status(400)
    //     .json({ error: "Missing order price or artist Stripe account" });
    // }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: price,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        orderId: orderId,
      },
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/payout", async (req, res) => {
  try {
    const { amount, stripeConnectId } = req.body;

    const transfer = await stripe.transfers.create({
      amount: amount * 100,
      currency: "usd",
      destination: stripeConnectId,
    });

    res.status(200).json({
      success: true,
      data: transfer,
    });
  } catch (error) {
    console.error("Error creating payout:", error);
  }
});

router.post("/create-stripe-account", async (req, res) => {
  try {
    const rawToken = getAuthToken(req);
    if (!rawToken) return res.status(401).json({ success: false, message: "No token found" });

    let decoded;
    try {
      decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const user = await UserModel.findById(decoded._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // If Stripe account exists, make a fresh onboarding link
    if (user.stripeAccountId) {
      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: process.env.STRIPE_REFRESH_URL || "https://immpression.com/stripe/reauth",
        return_url: process.env.STRIPE_RETURN_URL || "https://immpression.com/stripe/success",
        type: "account_onboarding",
      });

      return res.status(200).json({
        success: true,
        data: accountLink,
        user: {
          _id: user._id,
          email: user.email,
          stripeAccountId: user.stripeAccountId,
          stripeOnboardingCompleted: user.stripeOnboardingCompleted,
        },
        message: "Stripe account already exists, new onboarding link generated",
      });
    }

    // Create account then link
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user.email,
      business_type: "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { app_user_id: String(user._id), username: user.userName || "NoName" },
    });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: process.env.STRIPE_REFRESH_URL || "https://immpression.com/stripe/reauth",
      return_url: process.env.STRIPE_RETURN_URL || "https://immpression.com/stripe/success",
      type: "account_onboarding",
    });

    user.stripeAccountId = account.id;
    await user.save();

    return res.status(200).json({
      success: true,
      data: accountLink,
      user: {
        _id: user._id,
        email: user.email,
        stripeAccountId: user.stripeAccountId,
        stripeOnboardingCompleted: user.stripeOnboardingCompleted,
      },
      message: "Stripe account created and onboarding link generated",
    });
  } catch (error) {
    console.error("❌ Error creating Stripe account:", error);
    return res.status(500).json({ success: false, message: "Stripe account creation failed", error: error.message });
  }
});


// router.post("/createStripeOnboardingLink", async (req, res) => {
//   console.log("----------------------------->>>>>>> ", req.body.stripeConnectId);
//   try {
//     const accountLink = await stripe.accountLinks.create({
//       account: req.body.stripeConnectId, // Changed from req.stripeConnectId
//       refresh_url: "https://immpression.com/stripe/reauth",
//       return_url: "https://immpression.com/stripe/success",
//       type: "account_onboarding",
//     });
//     res.status(200).json({
//       success: true,
//       data: accountLink,
//     });
//   } catch (error) {
//     console.error("Error creating Stripe onboarding link:", error);
//     res.status(500).json({
//       success: false,
//       error: "Failed to create Stripe onboarding link"
//     });
//   }
// });
// Webhook handler for Stripe events

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // looks like: whsec_...

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Optional: idempotency guard if you store processed event IDs
    // const already = await WebhookEventModel.findOne({ eventId: event.id });
    // if (already) return res.json({ received: true });

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const pi = event.data.object; // PaymentIntent
          const orderId = pi.metadata?.orderId;

          if (orderId) {
            await OrderModel.findOneAndUpdate(
              { _id: orderId },
              {
                status: "paid",
                paymentStatus: "paid",
                paymentIntentId: pi.id,
                paidAt: new Date(),
              }
            );

            try {
              const paidOrder = await OrderModel.findById(orderId).lean();
              if (paidOrder) {
                // Notify seller: payment received
                await Notification.create({
                  recipientUserId: paidOrder.artistUserId, // seller
                  actorUserId: paidOrder.userId,           // buyer
                  type: NOTIFICATION_TYPE.ORDER_PAID,
                  title: "Payment received",
                  message: `Payment confirmed for "${paidOrder.artName}".`,
                  orderId: paidOrder._id,
                  imageId: paidOrder.imageId,
                  data: {
                    artName: paidOrder.artName,
                    price: paidOrder.price,
                    imageLink: paidOrder.imageLink,
                  },
                });

                // Notify seller: needs shipping
                await Notification.create({
                  recipientUserId: paidOrder.artistUserId, // seller
                  actorUserId: paidOrder.userId,           // buyer
                  type: NOTIFICATION_TYPE.ORDER_NEEDS_SHIPPING,
                  title: "Action needed: Ship order",
                  message: `"${paidOrder.artName}" is paid and ready to ship. Add tracking info to notify the buyer.`,
                  orderId: paidOrder._id,
                  imageId: paidOrder.imageId,
                  data: {
                    artName: paidOrder.artName,
                    price: paidOrder.price,
                    imageLink: paidOrder.imageLink,
                  },
                });
              }
            } catch (nErr) {
              console.error("⚠️ Notification create error (paid):", nErr);
            }
          }
          break;
        }

        case "payment_intent.payment_failed": {
          const pi = event.data.object; // PaymentIntent
          const orderId = pi.metadata?.orderId;

          if (orderId) {
            await OrderModel.findOneAndUpdate(
              { _id: orderId },
              {
                status: "failed",
                paymentStatus: "failed",
                paymentIntentId: pi.id,
                failureReason: pi.last_payment_error?.message,
              }
            );
          }
          break;
        }

        case "charge.refunded": {
          const charge = event.data.object; // Charge
          const paymentIntentId = charge.payment_intent;

          if (paymentIntentId) {
            await OrderModel.findOneAndUpdate(
              { paymentIntentId },
              {
                status: "refunded",
                paymentStatus: "refunded",
                refundedAt: new Date(),
              }
            );
          }
          break;
        }

        // You can handle more event types here if needed:
        // case "account.updated":
        // case "payout.paid":
        // ...

        default:
          // For unhandled events, just acknowledge
          break;
      }

      // Optional: record processed event ID for idempotency
      // await WebhookEventModel.create({ eventId: event.id, type: event.type });

      return res.json({ received: true });
    } catch (err) {
      console.error("❌ Error processing webhook:", err);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

router.post("/check-stripe-status", async (req, res) => {
  try {
    const rawToken = getAuthToken(req);
    if (!rawToken) return res.status(401).json({ success:false, message:"No token found" });

    let decoded;
    try {
      decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success:false, message:"Invalid or expired token" });
    }

    const user = await UserModel.findById(decoded._id);
    if (!user || !user.stripeAccountId) {
      return res.status(400).json({ success:false, message:"No Stripe account found for this user" });
    }

    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    const { id: stripeAccountId, details_submitted, charges_enabled, payouts_enabled, requirements = {} } = account;
    const { currently_due = [], disabled_reason } = requirements;

    if (details_submitted && !user.stripeOnboardingCompleted) {
      user.stripeOnboardingCompleted = true;
      user.stripeOnboardingCompletedAt = new Date();
      await user.save();
    }

    return res.status(200).json({
      success: true,
      message: "Stripe account status checked successfully",
      data: {
        stripeAccountId,
        details_submitted,
        charges_enabled,
        payouts_enabled,
        onboarding_completed: user.stripeOnboardingCompleted,
        requirements: { currently_due, disabled_reason },
      },
    });
  } catch (error) {
    console.error("❌ Error checking Stripe account status:", error);
    return res.status(500).json({ success:false, message:"Failed to check Stripe account status" });
  }
});


router.get("/orders", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await OrderModel.find()
      .populate("imageId", "imageLink") // 👈 pulls imageLink from referenced Image
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalOrders = await OrderModel.countDocuments();

    // 👇 Flatten imageLink into top-level order field
    const enrichedOrders = orders.map((order) => {
      const plain = order.toObject();
      plain.imageLink = order.imageId?.imageLink || "https://via.placeholder.com/50";
      return plain;
    });

    res.status(200).json({
      success: true,
      data: enrichedOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

router.get("/my-orders", isUserAuthorized, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await OrderModel.find({ userId: req.user._id })
      .populate("imageId", "imageLink")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalOrders = await OrderModel.countDocuments({ userId: req.user._id });

    const enrichedOrders = orders.map((order) => {
      const plain = order.toObject();
      plain.imageLink = order.imageId?.imageLink || "https://via.placeholder.com/50";
      return plain;
    });

    res.status(200).json({
      success: true,
      data: enrichedOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});


router.put("/order/:id", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      paymentStatus,
      status,
      deliveryDetails,
      price,
      artName,
      artistName,
      transactionId,
    } = req.body;

    // Find the order first
    const order = await OrderModel.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    // Create update object with only provided fields
    const updateData = {};
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (status) updateData.status = status;
    if (deliveryDetails) updateData.deliveryDetails = deliveryDetails;
    if (price) updateData.price = price;
    if (artName) updateData.artName = artName;
    if (artistName) updateData.artistName = artistName;
    if (transactionId) updateData.transactionId = transactionId;

    // Update the order
    const updatedOrder = await OrderModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: updatedOrder,
      message: "Order updated successfully",
    });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

// PATCH /order/:id/tracking
router.patch("/order/:id/tracking", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber?.trim()) {
      return res.status(400).json({ success: false, message: "trackingNumber is required" });
    }
    const tn = trackingNumber.trim().toUpperCase();

    const order = await OrderModel.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (String(order.artistUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not allowed to modify this order" });
    }

    const carrierLc = String(carrier || "").toLowerCase();

    // === DIRECT UPS BRANCH ===
    if (carrierLc === "ups" || /^1Z[0-9A-Z]{16}$/.test(tn)) {
      try {
        // ---- MOCK: allow test numbers in any env when flag is set OR forceMock=1 ----
        const allowMock = (process.env.UPS_ALLOW_TEST_NUMBERS || "").toLowerCase() === "true";
        const forceMock = String(req.query.forceMock || "").trim() === "1";
        let upsData;

        if (forceMock || (allowMock && isTestTrackingNumber(tn))) {
          upsData = buildMockUpsTracking(tn);
        } else {
          upsData = await trackWithUPS(tn);
        }

        // Typical structure: upsData.trackResponse.shipment[0].package[0]
        const pkg = upsData?.trackResponse?.shipment?.[0]?.package?.[0];
        if (!pkg) {
          return res.status(400).json({ success: false, message: "UPS returned no package data." });
        }

        const currentStatus = pkg.currentStatus || {};
        const status = mapUpsStatus(currentStatus);

        // Map activities → trackingEvents (parse UPS date/time safely)
        const activities = Array.isArray(pkg?.activity) ? pkg.activity : [];
        const events = activities.map((a) => {
          const dt = parseUpsDate(a?.date, a?.time);
          const locParts = [
            a?.activityLocation?.address?.city,
            a?.activityLocation?.address?.stateProvince,
            a?.activityLocation?.address?.country
          ].filter(Boolean);

          const event = {
            status: String(a?.status?.description || a?.activityLocation?.address?.city || "").toLowerCase(),
            message: a?.status?.description || a?.activityScan || "",
            location: locParts.join(", "),
          };
          if (dt) event.datetime = dt;
          return event;
        });

        if (!order.shipping) order.shipping = {};
        order.shipping.trackingNumber = tn;
        order.shipping.carrier = "UPS";
        order.shipping.shipmentStatus = status;
        order.shipping.shippedAt = order.shipping.shippedAt || new Date();
        order.shipping.trackingEvents = events.filter(
          (e) => !("datetime" in e) || (e.datetime instanceof Date && !isNaN(e.datetime))
        );
        order.shipping.verified = order.shipping.verified || order.shipping.trackingEvents.length > 0;
        if (status === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
          order.shipping.deliveredAt = new Date();
        }

        if (status === SHIPMENT_STATUS.DELIVERED) {
          Notification.create({
            recipientUserId: order.userId,            // buyer
            actorUserId: order.artistUserId,          // seller
            type: NOTIFICATION_TYPE.ORDER_DELIVERED,
            title: "Delivered",
            message: `“${order.artName}” was delivered.`,
            orderId: order._id,
            imageId: order.imageId,
            data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
          }).catch(err => console.error("Notif create error:", err));
        }

        await order.save();

        // Notify buyer: seller added tracking
        Notification.create({
          recipientUserId: order.userId,              // buyer
          actorUserId: order.artistUserId,            // seller
          type: NOTIFICATION_TYPE.ORDER_SHIPPED,
          title: "Order shipped",
          message: `Your “${order.artName}” has been shipped via ${order.shipping.carrier}.`,
          orderId: order._id,
          imageId: order.imageId,
          data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
        }).catch(err => console.error("Notif create error:", err));

        return res.status(200).json({
          success: true,
          message: forceMock ? "Tracking saved (mock UPS data)." : "Tracking saved and verified with UPS.",
          data: { orderId: order._id, shipping: order.shipping },
        });
      } catch (e) {
        const code = e.status || 400;
        return res.status(code).json({ success: false, message: e.message || "UPS validation failed." });
      }
    }

    // === FALLBACK (AfterShip) for non-UPS ===
    let created;
    try {
      created = await axios.post(
        "https://api.aftership.com/v4/trackings",
        {
          tracking: {
            tracking_number: tn,
            ...(carrier ? { slug: String(carrier).toLowerCase() } : {}),
          },
        },
        {
          headers: {
            "aftership-api-key": process.env.AFTERSHIP_API_KEY,
            "Content-Type": "application/json",
          },
          validateStatus: () => true,
        }
      );

      if (created.status !== 409 && created.status >= 400) {
        const msg =
          created.data?.meta?.message ||
          created.data?.meta?.error?.type ||
          "Invalid or unsupported tracking number.";
        return res.status(400).json({ success: false, message: msg });
      }
    } catch {
      return res.status(400).json({ success: false, message: "Tracking validation failed." });
    }

    const slugForGet = (carrier ? String(carrier).toLowerCase() : "auto");
    const fetched = await axios.get(
      `https://api.aftership.com/v4/trackings/${slugForGet}/${encodeURIComponent(tn)}`,
      { headers: { "aftership-api-key": process.env.AFTERSHIP_API_KEY } }
    );

    const t = fetched.data?.data?.tracking;
    if (!t) {
      return res.status(400).json({ success: false, message: "Unable to retrieve tracking details." });
    }

    const status = mapStatus(t.tag || t.subtag || t.status);
    const titleCarrier = toTitleCaseCarrier(t.slug || carrier);

    if (!order.shipping) order.shipping = {};
    order.shipping.trackingNumber = tn;
    order.shipping.carrier = titleCarrier;
    order.shipping.shipmentStatus = status;
    order.shipping.shippedAt = order.shipping.shippedAt || new Date();
    order.shipping.aftershipTrackingId = t.id;

    const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
    order.shipping.trackingEvents = checkpoints.map((c) => {
      const dt = c.checkpoint_time ? new Date(c.checkpoint_time) : undefined;
      const event = {
        status: String(c.tag || c.subtag || c.status || "").toLowerCase(),
        message: c.message || c.checkpoint_message,
        location: [c.city, c.state, c.country_name].filter(Boolean).join(", "),
      };
      if (dt && !isNaN(dt)) event.datetime = dt;
      return event;
    });

    order.shipping.verified = order.shipping.verified || order.shipping.trackingEvents.length > 0;
    if (status === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
      order.shipping.deliveredAt = new Date();
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Tracking saved and verified.",
      data: { orderId: order._id, shipping: order.shipping },
    });
  } catch (error) {
    console.error("Error verifying/saving tracking:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


router.delete("/order/:id", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await OrderModel.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    await OrderModel.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

router.get("/ups/ping", async (req, res) => {
  try {
    const token = await getUpsToken();
    return res.json({
      ok: true,
      tokenPreview: token ? token.slice(0, 16) + "…" : null,
      env: process.env.UPS_ENV,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// List MY SALES (orders where I'm the seller/artist)
router.get("/my-sales", isUserAuthorized, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const statusFilter = (req.query.status || "").trim();
    const query = { artistUserId: req.user._id };
    if (statusFilter) {
      query.$or = [
        { status: new RegExp(`^${statusFilter}$`, "i") },
        { "shipping.shipmentStatus": new RegExp(`^${statusFilter}$`, "i") }
      ];
    }

    const sales = await OrderModel.find(query)
      .populate("imageId", "imageLink")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalSales = await OrderModel.countDocuments(query);

    const enriched = sales.map((o) => {
      const shipping = o.shipping || {};
      const buyerFriendly =
        o.userAccountName ||
        (o.userId && typeof o.userId === "object" && (o.userId.name || o.userId.userName)) ||
        "Buyer";

      return {
        ...o,
        imageLink: o.imageId?.imageLink || "https://via.placeholder.com/50",
        buyerName: buyerFriendly,
        // normalized tracking info for the UI
        tracking: {
          trackingNumber: shipping.trackingNumber || null,
          carrier: shipping.carrier || null,
          shipmentStatus: shipping.shipmentStatus || o.status || "processing",
          shippedAt: shipping.shippedAt || null,
          deliveredAt: shipping.deliveredAt || null,
          trackingEvents: shipping.trackingEvents || [],
        },
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalSales / limit),
        totalSales,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching my sales:", error);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});


export default router;
