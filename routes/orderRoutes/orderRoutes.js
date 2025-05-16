import express from 'express';
import OrderModel from '../../models/orders.js';
import UserModel from '../../models/users.js';
import { isUserAuthorized } from '../../utils/authUtils.js';

import Stripe from 'stripe';

// env variable
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

router.post('/order', isUserAuthorized, async (req, res) => {
  try {
    const { artName, artistName, price, imageLink, deliveryDetails } = req.body;

    // Validate input
    if (!artName || !artistName || !price || !deliveryDetails) {
      return res.status(400).json({
        success: false,
        error: 'Missing required order fields.',
      });
    }

    // Lookup the artist by name (or however you're tracking artists)
    const artist = await UserModel.findOne({ name: artistName });

    if (!artist || !artist.stripeAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Artist not found or not connected to Stripe.',
      });
    }

    // Create the order
    const newOrder = new OrderModel({
      artName,
      artistName,
      price,
      artistStripeId: artist.stripeAccountId, // from UserModel
      imageLink, // if you want to save image link
      deliveryDetails,
      userAccountName: req.user.name,
      userId: req.user._id,
    });

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      order: newOrder,
      orderId: newOrder._id, // make sure frontend receives this
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});


router.post('/create-payment-intent', isUserAuthorized, async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!order.price || !order.artistStripeId) {
      return res.status(400).json({ error: 'Missing order price or artist Stripe account' });
    }

    const amountInCents = Math.round(order.price * 100); // Convert dollars to cents

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: 'usd',
        payment_method_types: ['card'],
        application_fee_amount: Math.round(amountInCents * 0.1), // 10% platform fee
      },
      {
        stripeAccount: order.artistStripeId, // Connected Stripe account for the artist
      }
    );

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
