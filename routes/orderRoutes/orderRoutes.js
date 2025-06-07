import express from "express";
import OrderModel from "../../models/orders.js";
import { isUserAuthorized } from "../../utils/authUtils.js";

import Stripe from "stripe";

// env variable
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

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
    const { artName, artistName, price, imageLink, deliveryDetails } = req.body;

    // Validate input
    if (!artName || !artistName || !price || !deliveryDetails) {
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
      payment_method_types: ["card"],
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
        process.env.STRIPE_WEBHOOK_SECRET
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

router.get("/orders", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await OrderModel.find()
      .sort({ createdAt: -1 }) // Sort by newest first
      .skip(skip)
      .limit(limit);

    const totalOrders = await OrderModel.countDocuments();

    res.status(200).json({
      success: true,
      data: orders,
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

export default router;
