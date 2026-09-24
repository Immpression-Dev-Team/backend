import OrderModel from "../models/orders.js";
import ImageModel from "../models/images.js";
import { normAddr } from "../utils/address.js";
import Notification, { NOTIFICATION_TYPE } from "../models/notifications.js";
import { SHIPMENT_STATUS } from "../models/orders.js";

const PRODIGI_API_KEY = process.env.PRODIGI_API_KEY;
const PRODIGI_API_BASE_URL = process.env.PRODIGI_API_BASE_URL || "https://api.sandbox.prodigi.com/v4.0";
const PRODIGI_IS_SANDBOX = PRODIGI_API_BASE_URL.includes("sandbox");

// One fixed print product for all Print on Demand artwork, for now — the
// artist never chooses a size/paper. Revisit if we ever offer more than one.
const PRODIGI_FIXED_SKU = "GLOBAL-FAP-16x24";
const PRODIGI_SHIPPING_METHOD = "Budget";

function prodigiHeaders() {
  return { "X-API-Key": PRODIGI_API_KEY, "Content-Type": "application/json" };
}

// Cost breakdown (in cents) for Prodigi to print + ship one copy of the
// fixed SKU to the given country — split so the buyer can see what they're
// actually paying for. Throws on failure — callers must not silently charge
// the buyer $0 for a real print cost.
export async function getProdigiPrintCostBreakdown({ countryCode }) {
  if (!PRODIGI_API_KEY) throw new Error("PRODIGI_API_KEY is not configured");

  const res = await fetch(`${PRODIGI_API_BASE_URL}/quotes`, {
    method: "POST",
    headers: prodigiHeaders(),
    body: JSON.stringify({
      shippingMethod: PRODIGI_SHIPPING_METHOD,
      destinationCountryCode: countryCode,
      currencyCode: "USD",
      items: [{ sku: PRODIGI_FIXED_SKU, copies: 1, assets: [{ printArea: "default" }] }],
    }),
  });

  const data = await res.json();
  const quote = data?.quotes?.[0];
  if (!res.ok || !quote) {
    throw new Error(`Prodigi quote failed: ${JSON.stringify(data)}`);
  }

  const printCents = Math.round(Number(quote.costSummary?.items?.amount || 0) * 100);
  const shippingCents = Math.round(Number(quote.costSummary?.shipping?.amount || 0) * 100);
  const totalCents = printCents + shippingCents;

  console.log(
    `[printFulfillmentService] ${PRODIGI_IS_SANDBOX ? "SANDBOX" : "LIVE"} Prodigi quote for ${PRODIGI_FIXED_SKU} -> ${countryCode}: print $${(printCents / 100).toFixed(2)} + shipping $${(shippingCents / 100).toFixed(2)} = $${(totalCents / 100).toFixed(2)}`
  );

  return { printCents, shippingCents, totalCents };
}

// Called when a paid order's artwork has fulfillmentType === "print_on_demand".
// Submits the real Prodigi order — sandbox-safe when PRODIGI_API_BASE_URL
// points at api.sandbox.prodigi.com (no real print, no real charge).
export async function handlePrintOnDemandOrder(order, { imageId } = {}) {
  console.log(
    `[printFulfillmentService] Prodigi is ${PRODIGI_IS_SANDBOX ? "SANDBOX" : "LIVE"} — submitting order ${order._id} (artwork ${imageId || order.imageId}).`
  );

  if (!PRODIGI_API_KEY) {
    console.error("[printFulfillmentService] PRODIGI_API_KEY missing — cannot submit order.");
    await OrderModel.findByIdAndUpdate(order._id, { printFulfillmentStatus: "failed" });
    return;
  }

  try {
    const artwork = await ImageModel.findById(imageId || order.imageId).lean();
    const sourceImageUrl =
      artwork?.printSourceMeta?.originalImageUrl || artwork?.imageLink || order.imageLink;
    const address = normAddr(order.deliveryDetails || {});

    const body = {
      shippingMethod: PRODIGI_SHIPPING_METHOD,
      ...(process.env.PRODIGI_CALLBACK_URL && { callbackUrl: process.env.PRODIGI_CALLBACK_URL }),
      recipient: {
        name: order.deliveryDetails?.name || order.userAccountName || "Customer",
        address: {
          line1: address.line1,
          postalOrZipCode: address.postal_code,
          countryCode: address.country,
          townOrCity: address.city,
          stateOrCounty: address.state,
        },
      },
      items: [
        {
          sku: PRODIGI_FIXED_SKU,
          copies: 1,
          sizing: "fillPrintArea",
          assets: [{ printArea: "default", url: sourceImageUrl }],
        },
      ],
    };

    const res = await fetch(`${PRODIGI_API_BASE_URL}/orders/`, {
      method: "POST",
      headers: prodigiHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok || !data?.order?.id) {
      console.error(`[printFulfillmentService] Prodigi order creation failed for ${order._id}:`, data);
      await OrderModel.findByIdAndUpdate(order._id, { printFulfillmentStatus: "failed" });
      return;
    }

    console.log(
      `[printFulfillmentService] ${PRODIGI_IS_SANDBOX ? "SANDBOX" : "LIVE"} Prodigi order created: ${data.order.id} (stage: ${data.order.status?.stage}) for Immpression order ${order._id}`
    );

    await OrderModel.findByIdAndUpdate(order._id, {
      printFulfillmentStatus: "submitted",
      prodigiOrderId: data.order.id,
      prodigiOrderStatus: data.order.status?.stage || "unknown",
    });
  } catch (err) {
    console.error(`[printFulfillmentService] Error submitting Prodigi order for ${order._id}:`, err);
    await OrderModel.findByIdAndUpdate(order._id, { printFulfillmentStatus: "failed" });
  }
}

// Fetches the current state of a Prodigi order directly (used for polling,
// since the webhook can't reach a local/non-public backend).
export async function getProdigiOrderStatus(prodigiOrderId) {
  const res = await fetch(`${PRODIGI_API_BASE_URL}/orders/${prodigiOrderId}`, {
    headers: prodigiHeaders(),
  });
  const data = await res.json();
  if (!res.ok || !data?.order) {
    throw new Error(`Prodigi order lookup failed for ${prodigiOrderId}: ${JSON.stringify(data)}`);
  }
  const order = data.order;
  const shipment = order.shipments?.[0];
  return {
    stage: order.status?.stage || "unknown",
    trackingNumber: shipment?.tracking?.number || null,
    trackingUrl: shipment?.tracking?.url || null,
    // Prodigi's `carrier` is an object ({ name, service }), but our
    // shipping.carrier schema field is a plain carrier-name string.
    carrier: shipment?.carrier?.name || null,
  };
}

// Applies a Prodigi order snapshot (from polling or the webhook) to the
// matching Immpression order: updates our internal prodigiOrderStatus, and
// — the first time it transitions to "Complete" (shipped) — populates the
// same `shipping.*` fields the seller-fulfilled flow uses, so the existing
// mobile order screens show Prodigi's tracking info with no UI changes.
export async function applyProdigiOrderSnapshot({ prodigiOrderId, stage, trackingNumber, trackingUrl, carrier }) {
  if (!prodigiOrderId) return;
  const order = await OrderModel.findOne({ prodigiOrderId });
  if (!order) return;

  const wasComplete = order.prodigiOrderStatus === "Complete";
  order.prodigiOrderStatus = stage || "unknown";

  if (stage === "Complete" && !wasComplete) {
    order.shipping = order.shipping || {};
    order.shipping.shipmentStatus = SHIPMENT_STATUS.SHIPPED;
    order.shipping.shippedAt = order.shipping.shippedAt || new Date();
    if (trackingNumber) order.shipping.trackingNumber = trackingNumber;
    if (carrier) order.shipping.carrier = carrier;
    if (trackingUrl) order.shipping.trackingDetails = { url: trackingUrl };

    console.log(`[printFulfillmentService] Prodigi order ${prodigiOrderId} shipped — Immpression order ${order._id}.`);

    await Promise.allSettled([
      Notification.create({
        recipientUserId: order.userId,
        actorUserId: order.artistUserId,
        type: NOTIFICATION_TYPE.ORDER_SHIPPED,
        title: "Your order shipped",
        message: `"${order.artName}" has been printed and shipped by Immpression.`,
        orderId: order._id, imageId: order.imageId,
        data: { artName: order.artName, price: order.baseAmount, imageLink: order.imageLink },
      }),
      Notification.create({
        recipientUserId: order.artistUserId,
        actorUserId: order.userId,
        type: NOTIFICATION_TYPE.ORDER_SHIPPED,
        title: "Order shipped",
        message: `"${order.artName}" has shipped. You'll be paid automatically 10 days after shipping.`,
        orderId: order._id, imageId: order.imageId,
        data: { artName: order.artName, price: order.baseAmount, imageLink: order.imageLink },
      }),
    ]);
  }

  await order.save();
}
