import Stripe from "stripe";
import OrderModel from "../models/orders.js";
import { FULFILLMENT_TYPE } from "../models/images.js";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const posInt = (n) => Math.max(0, Math.round(Number(n || 0)));

// Pays the remaining amount owed to the seller for a paid order — shared by
// the admin-triggered route and automated payout triggers (delivery
// detection for seller-fulfilled orders, the 10-day timer for Print on
// Demand). Throws PayoutError with a `code`/message on any guard failure so
// callers (route vs. background job) can handle it appropriately; returns
// { skipped: true, reason } when there's simply nothing to pay yet.
export class PayoutError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Fire-and-forget wrapper for automated payout triggers — carrier delivery
// confirmation (seller-fulfilled) or the 10-day post-ship timer (Print on
// Demand). Never throws — a payout hiccup must not break the tracking-poll
// response that called it.
export async function triggerAutoPayout(orderId) {
  try {
    const result = await payoutSellerForOrder(orderId);
    if (result.skipped) {
      console.log(`[payoutService] Auto-payout for order ${orderId} skipped: ${result.reason}`);
    } else {
      console.log(`[payoutService] Auto-payout: order ${orderId}, transfer ${result.transfer.id}`);
    }
  } catch (err) {
    console.error(`[payoutService] Auto-payout failed for order ${orderId}:`, err.message || err);
  }
}

export async function payoutSellerForOrder(orderId, { amountCentsCap } = {}) {
  const order = await OrderModel.findById(orderId);
  if (!order) throw new PayoutError("Order not found", "order_not_found");
  if ((order.status || "").toLowerCase() !== "paid")
    throw new PayoutError("Order not paid", "not_paid");
  if (!order.artistStripeId)
    throw new PayoutError("Seller not connected to Stripe", "no_stripe_account");
  if (!order.chargeId)
    throw new PayoutError("Order chargeId missing", "no_charge");

  // Print on Demand: don't release payout until Prodigi has actually
  // shipped it — the artist has nothing to do but wait until then.
  if (
    order.fulfillmentType === FULFILLMENT_TYPE.PRINT_ON_DEMAND &&
    order.prodigiOrderStatus !== "Complete"
  ) {
    throw new PayoutError(
      `Print on Demand order not yet shipped by Prodigi (status: ${order.prodigiOrderStatus || "unknown"})`,
      "not_shipped"
    );
  }

  const charge = await stripe.charges.retrieve(order.chargeId, { expand: ["balance_transaction"] });
  const bt = charge.balance_transaction;
  if (!bt) throw new PayoutError("Balance transaction not available yet", "no_balance_tx");

  const base     = posInt(order.baseAmount ?? order.price);
  const shipping = posInt(order.shippingAmount);
  const tax      = posInt(order.taxAmount);
  const stripeFee = posInt(bt.fee);
  const net       = posInt(bt.net);

  // Policy: hold 100% of tax + 3% of base; pay remainder after Stripe fee.
  // For Print on Demand, `shipping` is Prodigi's cost, not the seller's —
  // exclude it from the artist's share.
  const platformHoldOnBase = Math.round(base * 0.03);
  const sellerTarget =
    order.fulfillmentType === FULFILLMENT_TYPE.PRINT_ON_DEMAND
      ? Math.max(0, (net - tax - shipping) - platformHoldOnBase)
      : Math.max(0, (net - tax) - platformHoldOnBase);

  const alreadySent = posInt(order.sellerTransferredCents || 0);
  let remaining = Math.max(0, sellerTarget - alreadySent);

  const cap = posInt(amountCentsCap);
  if (cap > 0) remaining = Math.min(remaining, cap);

  if (remaining === 0) {
    return { skipped: true, reason: "nothing_to_pay", sellerTarget, alreadySent, remaining: 0 };
  }

  const transferGroup = order.transferGroup || `order_${order._id}`;
  const idempotencyKey = `transfer_order_${order._id}_${alreadySent + remaining}`;

  const transfer = await stripe.transfers.create({
    amount: remaining,
    currency: "usd",
    destination: order.artistStripeId,
    transfer_group: transferGroup,
    source_transaction: order.chargeId,
    metadata: {
      orderId: String(order._id),
      base: String(base),
      shipping: String(shipping),
      tax: String(tax),
      stripeFee: String(stripeFee),
      platformHoldOnBase: String(platformHoldOnBase),
    },
  }, { idempotencyKey });

  order.sellerTransferredCents = (order.sellerTransferredCents || 0) + remaining;
  await order.save();

  return {
    skipped: false,
    transfer,
    seller: {
      target: sellerTarget,
      alreadySent: order.sellerTransferredCents,
      remaining: Math.max(0, sellerTarget - order.sellerTransferredCents),
    },
  };
}
