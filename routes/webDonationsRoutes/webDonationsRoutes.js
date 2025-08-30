// routes/webDonationsRoutes/webDonationsRoutes.js
import express from "express";
import Stripe from "stripe";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Build a base URL from request Origin (fallbacks included)
function getBaseUrl(req) {
  const origin = req.headers.origin; // e.g., "http://localhost:3000"
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");

  const envUrl = process.env.CLIENT_URL; // e.g., "https://your-site.com"
  if (envUrl && /^https?:\/\//i.test(envUrl)) return envUrl.replace(/\/$/, "");

  const host = req.headers.host; // e.g., "localhost:5003"
  return host ? `http://${host}` : "http://localhost:3000";
}

// Ensure an absolute URL with scheme; if relative or missing scheme, join with base
function toAbsoluteUrl(url, base) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;          // already absolute
  if (url.startsWith("/")) return `${base}${url}`;     // join path to base
  return `${base}/${url}`;                             // generic fallback
}

function normalizeAmount(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n)) return 2500;
  const i = Math.round(n);
  if (i < 100) return 100;            // $1 min
  if (i > 5_000_000) return 5_000_000; // $50k max
  return i;
}

router.post("/donations/create-checkout-session", async (req, res) => {
  try {
    const { amountCents = 2500, note = "", successUrl, cancelUrl } = req.body || {};
    const unitAmount = normalizeAmount(amountCents);

    const base = getBaseUrl(req); // "http://localhost:3000" in dev
    const success_url = toAbsoluteUrl(successUrl, base) || `${base}/thank-you?sid={CHECKOUT_SESSION_ID}`;
    const cancel_url  = toAbsoluteUrl(cancelUrl,  base) || `${base}/`;

    // Helpful logs while you test
    console.log("[Donations] base:", base);
    console.log("[Donations] success_url:", success_url);
    console.log("[Donations] cancel_url:", cancel_url);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "donate",
      payment_method_types: ["card", "us_bank_account"],
      success_url,
      cancel_url,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Back Immpression", description: note?.slice(0, 200) || "Support the Immpression project" },
          unit_amount: unitAmount,
        },
        quantity: 1,
      }],
      metadata: { intent: "donation", note: note?.slice(0, 500) || "", source: "web_landing" },
      // No transfer_data / on_behalf_of → platform payout
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Create donation session error:", err);
    res.status(500).json({ error: "Failed to create donation session" });
  }
});

/**
 * Stripe webhook for donations (separate path/secret from your Connect webhook).
 * Set DONATIONS_WEBHOOK_SECRET in your env.
 */
router.post(
  "/donations/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.DONATIONS_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Donations webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          // TODO: record donation in your DB, send thank-you email, etc.
          // session.amount_total (cents), session.customer_email, session.id, session.metadata
          break;
        }
        // Add more events if you need (payment_intent.succeeded, charge.refunded, etc.)
        default:
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error("Error handling donations webhook:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

export default router;
