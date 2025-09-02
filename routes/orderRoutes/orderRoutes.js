import express from "express";
import OrderModel, {SHIPMENT_STATUS} from "../../models/orders.js";
import ImageModel from "../../models/images.js";
import UserModel from "../../models/users.js";
import { isUserAuthorized, isAdminAuthorized } from "../../utils/authUtils.js";
import axios from 'axios';


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
    case "pre_transit":        return SHIPMENT_STATUS.SHIPPED;
    case "in_transit":         return SHIPMENT_STATUS.IN_TRANSIT;
    case "out_for_delivery":   return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
    case "delivered":          return SHIPMENT_STATUS.DELIVERED;
    case "available_for_pickup":
    case "exception":
    case "failed_attempt":
    case "return_to_sender":   return SHIPMENT_STATUS.EXCEPTION;
    default:                   return SHIPMENT_STATUS.SHIPPED;
  }
};

// Normalize common slugs (your schema stores TitleCase carriers)
const toTitleCaseCarrier = (slugOrName) => {
  const s = String(slugOrName || "").toLowerCase();
  if (s.includes("usps")) return "USPS";
  if (s.includes("ups")) return "UPS";
  if (s.includes("fedex")) return "FedEx";
  if (s.includes("dhl")) return "DHL";
  return slugOrName || "USPS";
};

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
    // Step 1: Get and verify JWT token
    const token = req.cookies["auth-token"];
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "No token found" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }

    const userId = decoded._id;

    // Step 2: Fetch user from DB
    const user = await UserModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Step 3: If Stripe account exists, create new onboarding link
    if (user.stripeAccountId) {
      // Create new onboarding link for existing account
      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url:
          process.env.STRIPE_REFRESH_URL ||
          "https://immpression.com/stripe/reauth",
        return_url:
          process.env.STRIPE_RETURN_URL ||
          "https://immpression.com/stripe/success",
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

    // Step 4: Create Stripe account
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user.email,
      business_type: "individual",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        app_user_id: user._id.toString(),
        username: user.userName || "NoName",
      },
    });

    // Step 5: Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url:
        process.env.STRIPE_REFRESH_URL ||
        "https://immpression.com/stripe/reauth",
      return_url:
        process.env.STRIPE_RETURN_URL ||
        "https://immpression.com/stripe/success",
      type: "account_onboarding",
    });

    // Step 6: Save Stripe account ID to user
    user.stripeAccountId = account.id;
    await user.save();

    // Step 7: Respond
    const responseData = {
      success: true,
      data: accountLink,
      user: {
        _id: user._id,
        email: user.email,
        stripeAccountId: user.stripeAccountId,
        stripeOnboardingCompleted: user.stripeOnboardingCompleted,
      },
      message: "Stripe account created and onboarding link generated",
    };

    console.log("✅ Sending response to frontend:", {
      success: responseData.success,
      message: responseData.message,
      accountLinkUrl: responseData.data?.url,
      stripeAccountId: responseData.user?.stripeAccountId,
    });

    res.status(200).json(responseData);
  } catch (error) {
    console.error("❌ Error creating Stripe account:", error);
    console.error("❌ Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    const errorResponse = {
      success: false,
      message: "Stripe account creation failed",
      error: error.message,
    };

    console.log("❌ Sending error response to frontend:", errorResponse);
    res.status(500).json(errorResponse);
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
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_TEST_KEY
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object;
          // Update order status to paid
          await OrderModel.findOneAndUpdate(
            { _id: paymentIntent.metadata.orderId },
            {
              status: "paid",
              paymentStatus: "paid",
              paymentIntentId: paymentIntent.id,
              paidAt: new Date(),
            }
          );
          break;

        case "payment_intent.payment_failed":
          const failedPayment = event.data.object;
          // Update order status to failed
          await OrderModel.findOneAndUpdate(
            { _id: failedPayment.metadata.orderId },
            {
              status: "failed",
              paymentStatus: "failed",
              paymentIntentId: failedPayment.id,
              failureReason: failedPayment.last_payment_error?.message,
            }
          );
          break;

        case "charge.refunded":
          const refund = event.data.object;
          // Update order status to refunded
          await OrderModel.findOneAndUpdate(
            { paymentIntentId: refund.payment_intent },
            {
              status: "refunded",
              paymentStatus: "refunded",
              refundedAt: new Date(),
            }
          );
          break;
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

router.post("/check-stripe-status", async (req, res) => {
  try {
    const token = req.cookies["auth-token"];
    if (!token)
      return res
        .status(401)
        .json({ success: false, message: "No token found" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }

    const user = await UserModel.findById(decoded._id);
    if (!user || !user.stripeAccountId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "No Stripe account found for this user",
        });
    }

    const account = await stripe.accounts.retrieve(user.stripeAccountId);

    const {
      id: stripeAccountId,
      details_submitted,
      charges_enabled,
      payouts_enabled,
      requirements = {},
    } = account;

    const { currently_due = [], disabled_reason } = requirements;

    // Update onboarding status if completed
    if (details_submitted && !user.stripeOnboardingCompleted) {
      user.stripeOnboardingCompleted = true;
      user.stripeOnboardingCompletedAt = new Date();
      await user.save();
      console.log("✅ User onboarding completed:", user.email);
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
        requirements: {
          currently_due,
          disabled_reason,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error checking Stripe account status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check Stripe account status",
    });
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

// PATCH /order/:id/tracking -> verify with AfterShip, then save
router.patch("/order/:id/tracking", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber?.trim()) {
      return res.status(400).json({ success: false, message: "trackingNumber is required" });
    }

    const order = await OrderModel.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // 1) Create/Upsert tracking in AfterShip (this validates the number)
    let created;
    try {
      created = await axios.post(
        "https://api.aftership.com/v4/trackings",
        {
          tracking: {
            tracking_number: trackingNumber.trim(),
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

      if (created.status === 409) {
        // already exists
      } else if (created.status >= 400) {
        const msg =
          created.data?.meta?.message ||
          created.data?.meta?.error?.type ||
          "Invalid or unsupported tracking number.";
        return res.status(400).json({ success: false, message: msg });
      }
    } catch (e) {
      return res.status(400).json({ success: false, message: "Tracking validation failed." });
    }

    // 2) Fetch current tracking details
    const slugForGet = (carrier ? String(carrier).toLowerCase() : "auto");
    const fetched = await axios.get(
      `https://api.aftership.com/v4/trackings/${slugForGet}/${encodeURIComponent(
        trackingNumber.trim()
      )}`,
      { headers: { "aftership-api-key": process.env.AFTERSHIP_API_KEY } }
    );

    const t = fetched.data?.data?.tracking;
    if (!t) {
      return res.status(400).json({ success: false, message: "Unable to retrieve tracking details." });
    }

    const status = mapStatus(t.tag || t.subtag || t.status);
    const titleCarrier = toTitleCaseCarrier(t.slug || carrier);

    // 3) Update order
    if (!order.shipping) order.shipping = {};

    order.shipping.trackingNumber = trackingNumber.trim().toUpperCase();
    order.shipping.carrier = titleCarrier;
    order.shipping.shipmentStatus = status;
    order.shipping.shippedAt = order.shipping.shippedAt || new Date();
    order.shipping.aftershipTrackingId = t.id;

    // Events (AfterShip calls them checkpoints)
    const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
    order.shipping.trackingEvents = checkpoints.map((c) => ({
      status: String(c.tag || c.subtag || c.status || "").toLowerCase(),
      message: c.message || c.checkpoint_message,
      datetime: c.checkpoint_time ? new Date(c.checkpoint_time) : undefined,
      location: [c.city, c.state, c.country_name].filter(Boolean).join(", "),
    }));

    order.shipping.verified = order.shipping.verified || checkpoints.length > 0;

    if (status === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
      order.shipping.deliveredAt = new Date();
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Tracking saved and verified with AfterShip.",
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

export default router;
