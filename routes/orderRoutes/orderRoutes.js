import express from "express";
import OrderModel, {SHIPMENT_STATUS} from "../../models/orders.js";
import UserModel from "../../models/users.js";
import { isUserAuthorized } from "../../utils/authUtils.js";
import EasyPost from '@easypost/api';


import Stripe from "stripe";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();
import jwt from "jsonwebtoken";

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

    // Validate input
    if (!imageId || !artName || !artistName || !price || !deliveryDetails) {
      return res.status(400).json({
        success: false,
        error: "Missing required order fields.",
      });
    }

    // Lookup the artist by name (or however you're tracking artists)
    // const artist = await UserModel.findOne({ name: artistName });

    // if (!artist || !artist.stripeAccountId) {
    //   return res.status(400).json({
    //     success: false,
    //     error: "Artist not found or not connected to Stripe.",
    //   });
    // }

    // Create the order
    const newOrder = new OrderModel({
      imageId,
      artName,
      artistName,
      price,
      artistStripeId: "abc123", // from UserModel
      imageLink, // if you want to save image link
      deliveryDetails,
      userAccountName: req.user.name,
      userId: req.user._id,
      status: "pending",
    });

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order: newOrder,
      orderId: newOrder._id, // make sure frontend receives this
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
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

// PATCH /order/:id/tracking  -> updates tracking number on an existing order
router.patch("/order/:id/tracking", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({
        success: false,
        message: "trackingNumber is required",
      });
    }

    const order = await OrderModel.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Ensure shipping object exists
    if (!order.shipping) order.shipping = {};

    // Update fields
    order.shipping.trackingNumber = trackingNumber;
    if (carrier) order.shipping.carrier = carrier;

    // Optionally bump status if you want to reflect shipment started
    // (only set if not already delivered/returned/etc.)
    if (!order.shipping.shipmentStatus) {
      order.shipping.shipmentStatus = SHIPMENT_STATUS.SHIPPED;
      order.shipping.shippedAt = new Date();
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Tracking number updated",
      data: {
        orderId: order._id,
        shipping: order.shipping,
      },
    });
  } catch (error) {
    console.error("Error updating tracking number:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

export default router;
