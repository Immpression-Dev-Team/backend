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

router.post("/order/:id/ship", isUserAuthorized, async (req, res) => {
  try {
    const { trackingNumber, carrier, shippingAddress } = req.body;
    
    // Validate required fields
    if (!trackingNumber || !carrier) {
      return res.status(400).json({ 
        message: "Tracking number and carrier are required" 
      });
    }

    // Find the image/order
    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order/Order not found" });
    }

    // Create EasyPost tracker
    const tracker = await easypost.Tracker.create({
      tracking_code: trackingNumber,
      carrier: carrier.toLowerCase()
    });

    // Update the image with shipping information
    order.shipping = {
      ...order.shipping,
      trackingNumber: trackingNumber,
      carrier: carrier,
      shipmentStatus: SHIPMENT_STATUS.SHIPPED,
      shippedAt: new Date(),
      easypostTrackerId: tracker.id,
      trackingDetails: tracker,
      shippingAddress: shippingAddress || order.shipping?.shippingAddress
    };

    await irder.save();

    res.json({ 
      message: "Shipping info added successfully", 
      tracking: {
        trackingNumber: trackingNumber,
        carrier: carrier,
        status: tracker.status,
        easypostId: tracker.id,
        publicUrl: tracker.public_url
      }
    });

  } catch (error) {
    console.error('EasyPost tracking error:', error);
    res.status(500).json({ 
      message: "Failed to create tracking", 
      error: error.message 
    });
  }
});

// Get tracking information for an image
router.get("/order/:id/tracking", isUserAuthorized, async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order/Order not found" });
    }

    if (!order.shipping?.easypostTrackerId) {
      return res.status(404).json({ message: "No tracking information available" });
    }

    // Retrieve updated tracking info from EasyPost
    const tracker = await easypost.Tracker.retrieve(order.shipping.easypostTrackerId);
    
    // Update local tracking data
    order.shipping.trackingDetails = tracker;
    order.shipping.shipmentStatus = mapEasyPostStatus(tracker.status);
    
    // Update tracking events
    if (tracker.tracking_details && tracker.tracking_details.length > 0) {
      order.shipping.trackingEvents = tracker.tracking_details.map(event => ({
        status: event.status,
        message: event.message,
        datetime: new Date(event.datetime),
        location: event.tracking_location ? 
          `${event.tracking_location.city}, ${event.tracking_location.state}` : ''
      }));
    }

    await order.save();

    res.json({
      trackingNumber: order.shipping.trackingNumber,
      carrier: order.shipping.carrier,
      status: tracker.status,
      estimatedDelivery: tracker.est_delivery_date,
      publicUrl: tracker.public_url,
      trackingEvents: order.shipping.trackingEvents,
      lastUpdated: tracker.updated_at
    });

  } catch (error) {
    console.error('Tracking retrieval error:', error);
    res.status(500).json({ 
      message: "Failed to retrieve tracking information", 
      error: error.message 
    });
  }
});

// Webhook endpoint to receive tracking updates from EasyPost
router.post("/webhook/easypost/tracking", async (req, res) => {
  try {
    const event = req.body;
    
    // Verify webhook signature (recommended for production)
    // const signature = req.headers['x-easypost-hmac-signature'];
    // if (!verifyWebhookSignature(req.body, signature)) {
    //   return res.status(401).json({ message: "Invalid signature" });
    // }

    if (event.object === 'Event' && event.description.includes('tracker.updated')) {
      const tracker = event.result;
      
      // Find image by EasyPost tracker ID
      const order = await OrderModel.findOne({ 
        'shipping.easypostTrackerId': tracker.id 
      });
      
      if (order) {
        // Update tracking information
        order.shipping.trackingDetails = tracker;
        order.shipping.shipmentStatus = mapEasyPostStatus(tracker.status);
        
        // Update tracking events
        if (tracker.tracking_details && tracker.tracking_details.length > 0) {
          order.shipping.trackingEvents = tracker.tracking_details.map(event => ({
            status: event.status,
            message: event.message,
            datetime: new Date(event.datetime),
            location: event.tracking_location ? 
              `${event.tracking_location.city}, ${event.tracking_location.state}` : ''
          }));
        }
        
        await order.save();
        
        // You could emit socket events here to notify users in real-time
        // io.emit(`tracking-update-${image._id}`, image.shipping);
      }
    }

    res.status(200).json({ message: "Webhook processed" });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

// Helper function to map EasyPost status to your internal status
function mapEasyPostStatus(easypostStatus) {
  const statusMap = {
    'pre_transit': SHIPMENT_STATUS.PROCESSING,
    'in_transit': SHIPMENT_STATUS.IN_TRANSIT,
    'out_for_delivery': SHIPMENT_STATUS.OUT_FOR_DELIVERY,
    'delivered': SHIPMENT_STATUS.DELIVERED,
    'available_for_pickup': SHIPMENT_STATUS.OUT_FOR_DELIVERY,
    'return_to_sender': SHIPMENT_STATUS.RETURNED,
    'failure': SHIPMENT_STATUS.EXCEPTION,
    'cancelled': SHIPMENT_STATUS.EXCEPTION,
    'error': SHIPMENT_STATUS.EXCEPTION
  };
  
  return statusMap[easypostStatus] || SHIPMENT_STATUS.IN_TRANSIT;
}

// Bulk tracking update (useful for batch processing)
router.post("/admin/tracking/bulk-update", isUserAuthorized, async (req, res) => {
  try {
    const orders = await OrderModel.find({
      'shipping.easypostTrackerId': { $exists: true },
      'shipping.shipmentStatus': { 
        $nin: [SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.RETURNED, SHIPMENT_STATUS.EXCEPTION] 
      }
    });

    const updatePromises = orders.map(async (order) => {
      try {
        const tracker = await easypost.Tracker.retrieve(order.shipping.easypostTrackerId);
        order.shipping.trackingDetails = tracker;
        order.shipping.shipmentStatus = mapEasyPostStatus(tracker.status);
        return order.save();
      } catch (error) {
        console.error(`Failed to update tracking for image ${order._id}:`, error);
        return null;
      }
    });

    const results = await Promise.allSettled(updatePromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
    res.json({
      message: `Bulk tracking update completed`,
      total: orders.length,
      successful: successful,
      failed: orders.length - successful
    });

  } catch (error) {
    console.error('Bulk tracking update error:', error);
    res.status(500).json({ message: "Bulk update failed", error: error.message });
  }
});

export default router;
