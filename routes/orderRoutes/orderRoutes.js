import express from 'express';
import OrderModel from '../../models/orders.js';
import { isUserAuthorized } from '../../utils/authUtils.js';

import Stripe from 'stripe';

// env variable
const stripe = Stripe('your-secret-key');

const router = express.Router();

router.post('/order', isUserAuthorized, async (req, res) => {
  try {
    const { artName, deliveryDetails } = req.body;

    // Validate input
    if (!artName || !deliveryDetails) {
      return res.status(400).json({
        success: false,
        error: 'Art name and delivery details are required.',
      });
    }

    // Create the order
    const newOrder = new OrderModel({
      artName,
      userAccountName: req.user.name, // Extract account name from req.user
      userId: req.user._id, // Extract user ID from req.user
      deliveryDetails,
    });

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      order: newOrder,
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    });
  }
});

router.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency } = req.body;

    // Validate the input
    if (!amount || !currency) {
      return res
        .status(400)
        .json({ error: 'Amount and currency are required' });
    }

    // Create the PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // Amount in the smallest currency unit (e.g., cents for USD)
      currency,
      payment_method_types: ['card'],
    });

    // Respond with the client secret
    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Error creating PaymentIntent:', error);
    res.status(500).json({ error: 'Server error Internal' });
  }
});

export default router;
