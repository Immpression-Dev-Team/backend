import mongoose from 'mongoose';

const { Schema } = mongoose;

const OrderSchema = new Schema(
  {
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
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

const OrderModel =
  mongoose.models.Order || mongoose.model('Order', OrderSchema);

export default OrderModel;
