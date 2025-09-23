import express from "express";
import OrderModel, { SHIPMENT_STATUS } from "../../models/orders.js";
import ImageModel from "../../models/images.js";
import UserModel from "../../models/users.js";
import { isUserAuthorized, isAdminAuthorized } from "../../utils/authUtils.js";
import axios from 'axios';
import Notification, { NOTIFICATION_TYPE } from "../../models/notifications.js";

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
    case "pre_transit": return SHIPMENT_STATUS.SHIPPED;
    case "in_transit": return SHIPMENT_STATUS.IN_TRANSIT;
    case "out_for_delivery": return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
    case "delivered": return SHIPMENT_STATUS.DELIVERED;
    case "available_for_pickup":
    case "exception":
    case "failed_attempt":
    case "return_to_sender": return SHIPMENT_STATUS.EXCEPTION;
    default: return SHIPMENT_STATUS.SHIPPED;
  }
};

function getAuthToken(req) {
  const bearer = req.headers.authorization?.split(" ")[1];
  return bearer || req.cookies?.["auth-token"] || null;
}

// Normalize common slugs (your schema stores TitleCase carriers)
const toTitleCaseCarrier = (slugOrName) => {
  const s = String(slugOrName || "").toLowerCase();
  if (s.includes("usps")) return "USPS";
  if (s.includes("ups")) return "UPS";
  if (s.includes("fedex")) return "FedEx";
  if (s.includes("dhl")) return "DHL";
  return slugOrName || "USPS";
};

// ===== UPS Direct Tracking (no AfterShip) =====

// ---- UPS test-number helpers (put near other UPS helpers) ----

// Public UPS demo numbers (or add your own)
const UPS_TEST_NUMBERS = new Set([
  "1Z12345E0291980793",
  "1Z12345E1512345676",
  "1Z12345E6615272234",
  "1Z12345E0205271688",
  "1Z12345E1392654435",
  "1Z12345E6892410846",
]);

function isTestTrackingNumber(tn) {
  const s = String(tn || "").toUpperCase().replace(/\s+/g, "");
  return UPS_TEST_NUMBERS.has(s);
}

function formatYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`; // UPS YYYYMMDD
}

function buildMockUpsTracking(tn) {
  const now = new Date();
  const tMinus = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    trackResponse: {
      shipment: [{
        package: [{
          trackingNumber: tn,
          currentStatus: { code: "I", description: "In Transit" },
          activity: [
            {
              date: formatYMD(tMinus(3)),
              time: "083000",
              status: { description: "Origin Scan" },
              activityLocation: { address: { city: "New York", stateProvince: "NY", country: "US" } }
            },
            {
              date: formatYMD(tMinus(1)),
              time: "104500",
              status: { description: "Departed UPS Facility" },
              activityLocation: { address: { city: "Secaucus", stateProvince: "NJ", country: "US" } }
            },
            {
              date: formatYMD(now),
              time: "071500",
              status: { description: "In Transit" },
              activityLocation: { address: { city: "Philadelphia", stateProvince: "PA", country: "US" } }
            }
          ]
        }]
      }]
    }
  };
}


// Choose base by env
const upsBase = () =>
  (process.env.UPS_ENV || "cie").toLowerCase() === "prod"
    ? "https://onlinetools.ups.com"
    : "https://wwwcie.ups.com";

// Token cache
let UPS_TOKEN = null;
let UPS_TOKEN_EXP = 0;

// Get OAuth token (client credentials), caches until ~60s before expiry
async function getUpsToken() {
  const now = Math.floor(Date.now() / 1000);
  if (UPS_TOKEN && UPS_TOKEN_EXP - 60 > now) return UPS_TOKEN;

  const url = `${upsBase()}/security/v1/oauth/token`;
  const auth = Buffer.from(
    `${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`
  ).toString("base64");

  // IMPORTANT: include scope=tracking
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "tracking",
  }).toString();

  let resp;
  try {
    resp = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      validateStatus: () => true,
    });
  } catch (e) {
    console.error("UPS OAuth network error:", e?.message || e);
    throw new Error("UPS OAuth request failed");
  }

  if (resp.status !== 200) {
    console.error("UPS OAuth error:", {
      status: resp.status,
      data: resp.data,
    });
    throw new Error(
      resp.data?.error_description ||
      resp.data?.error ||
      "UPS OAuth rejected credentials"
    );
  }

  UPS_TOKEN = resp.data?.access_token;
  const expiresIn = Number(resp.data?.expires_in || 0);
  UPS_TOKEN_EXP = Math.floor(Date.now() / 1000) + (expiresIn || 1800);

  return UPS_TOKEN;
}

// ---- add this helper near your UPS helpers ----
function parseUpsDate(ymd, hms) {
  const d = String(ymd || "").replace(/\D/g, "");
  if (d.length !== 8) return undefined;

  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));   // 01..12
  const day = Number(d.slice(6, 8)); // 01..31

  let hh = 0, mm = 0, ss = 0;
  const t = String(hms || "").replace(/\D/g, "");
  if (t.length >= 2) hh = Number(t.slice(0, 2));
  if (t.length >= 4) mm = Number(t.slice(2, 4));
  if (t.length >= 6) ss = Number(t.slice(4, 6));

  const jsDate = new Date(Date.UTC(y, m - 1, day, hh, mm, ss));
  return isNaN(jsDate.getTime()) ? undefined : jsDate;
}

// Map UPS status → your enum
function mapUpsStatus(upsStatusObj = {}) {
  // UPS response often has currentStatus: { code, description }
  const code = String(upsStatusObj.code || "").toUpperCase();
  const desc = String(upsStatusObj.description || "").toLowerCase();

  // Try code first, then fallback on description keywords
  if (code === "D" || /delivered/.test(desc)) return SHIPMENT_STATUS.DELIVERED;
  if (code === "O" || /out for delivery/.test(desc)) return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
  if (code === "I" || /in transit|arrived|departed|origin scan|destination scan/.test(desc))
    return SHIPMENT_STATUS.IN_TRANSIT;
  if (/exception|failed attempt|return to sender|hold/.test(desc))
    return SHIPMENT_STATUS.EXCEPTION;

  // Pre-transit / label created
  if (/label created|information received|pre[- ]?transit|order processed/.test(desc))
    return SHIPMENT_STATUS.SHIPPED;

  return SHIPMENT_STATUS.SHIPPED;
}

// ===== UPS OAuth (multiple scopes) =====
const UPS_TOKEN_CACHE = {}; // { scopeString: { token, exp } }

async function getUpsTokenWithScopes(scopes = ["rating"]) {
  const scopeKey = scopes.slice().sort().join(" ");
  const cached = UPS_TOKEN_CACHE[scopeKey];
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const url = `${upsBase()}/security/v1/oauth/token`;
  const auth = Buffer.from(
    `${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: scopeKey, // e.g. "rating" or "rating tracking"
  }).toString();

  const resp = await axios.post(url, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    throw new Error(
      resp.data?.error_description || resp.data?.error || "UPS OAuth (rating) failed"
    );
  }

  const token = resp.data?.access_token;
  const exp = now + Number(resp.data?.expires_in || 1800);
  UPS_TOKEN_CACHE[scopeKey] = { token, exp };
  return token;
}


// Fetch details from UPS Tracking API
async function trackWithUPS(inquiryNumber) {
  const token = await getUpsToken();
  const transId = `${Date.now()}`;
  const transactionSrc = process.env.UPS_TRANSACTION_SRC || "immpression";

  const url = `${upsBase()}/api/track/v1/details/${encodeURIComponent(inquiryNumber)}`;
  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      transId,
      transactionSrc,
      Accept: "application/json",
    },
    params: { locale: "en_US", returnSignature: "false" },
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    console.error("UPS Track error:", { status: resp.status, data: resp.data });
    const msg =
      resp.data?.response?.errors?.[0]?.message ||
      resp.data?.response?.errors?.[0]?.code ||
      resp.statusText ||
      "UPS tracking failed";
    const e = new Error(msg);
    e.status = resp.status;
    throw e;
  }

  return resp.data;
}

// Choose FedEx base by env
const fedexBase = () =>
  (process.env.FEDEX_ENV || "sandbox").toLowerCase() === "production"
    ? "https://apis.fedex.com"
    : "https://apis-sandbox.fedex.com";

// Token cache
let FEDEX_TOKEN = null;
let FEDEX_TOKEN_EXP = 0;

// Get FedEx OAuth token (client_credentials)
async function getFedexToken() {
  const now = Math.floor(Date.now() / 1000);
  if (FEDEX_TOKEN && FEDEX_TOKEN_EXP - 60 > now) return FEDEX_TOKEN;

  const env = String(process.env.FEDEX_ENV || "sandbox").trim().toLowerCase();
  const clientId = (process.env.FEDEX_CLIENT_ID || "").trim();
  const clientSecret = (process.env.FEDEX_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("FedEx OAuth: missing FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET");
  }

  const url = `${fedexBase()}/oauth/token`;
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    // Some tenants require scope; harmless if ignored:
    // scope: "oob"
  }).toString();

  // Also send Basic auth just in case tenant expects it
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let resp;
  try {
    resp = await axios.post(url, form, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": `Basic ${basic}`, // extra redundancy
      },
      validateStatus: () => true,
    });
  } catch (e) {
    console.error("FedEx OAuth network error:", e?.message || e);
    throw new Error("FedEx OAuth request failed");
  }

  if (resp.status !== 200) {
    const firstErr = (resp?.data?.errors && resp.data.errors[0]) || {};
    console.error("FedEx OAuth error:", {
      status: resp.status,
      env,
      base: fedexBase(),
      clientId_preview: clientId.slice(0, 4) + "…" + clientId.slice(-4),
      data: resp.data,
    });
    throw new Error(
      firstErr?.message ||
      firstErr?.code ||
      resp?.data?.error_description ||
      resp?.data?.error ||
      `FedEx OAuth rejected credentials (status ${resp.status})`
    );
  }

  FEDEX_TOKEN = resp.data?.access_token;
  const expiresIn = Number(resp.data?.expires_in || 0);
  FEDEX_TOKEN_EXP = Math.floor(Date.now() / 1000) + (expiresIn || 1800);

  return FEDEX_TOKEN;
}


// Map FedEx status → your enum
function mapFedexStatus(obj = {}) {
  const raw = String(
    obj?.description ||
    obj?.statusByLocale ||
    obj?.code ||
    obj
  ).toLowerCase();

  if (/delivered/.test(raw)) return SHIPMENT_STATUS.DELIVERED;
  if (/out for delivery/.test(raw)) return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
  if (/in transit|on its way|departed|arrived|at fedex location|at local facility/.test(raw))
    return SHIPMENT_STATUS.IN_TRANSIT;
  if (/exception|failed|delivery exception|hold|return/.test(raw))
    return SHIPMENT_STATUS.EXCEPTION;

  if (/label created|shipment information sent|picked up|pre[- ]?transit|order processed/.test(raw))
    return SHIPMENT_STATUS.SHIPPED;

  return SHIPMENT_STATUS.SHIPPED;
}

// Parse FedEx scan date/time (already ISO in most responses)
function parseFedexDate(iso) {
  if (!iso) return undefined;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
}

// Call FedEx Track API
async function trackWithFedex(trackingNumber) {
  const token = await getFedexToken();
  const url = `${fedexBase()}/track/v1/trackingnumbers`;

  const payload = {
    includeDetailedScans: true,
    trackingInfo: [
      {
        trackingNumberInfo: { trackingNumber },
      },
    ],
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    console.error("FedEx Track error:", { status: resp.status, data: resp.data });
    const msg =
      resp.data?.errors?.[0]?.message ||
      resp.data?.errors?.[0]?.code ||
      resp.statusText ||
      "FedEx tracking failed";
    const e = new Error(msg);
    e.status = resp.status;
    throw e;
  }

  return resp.data;
}

// tax helpers
const cents = (n) => Math.round(Number(n || 0));

// ===== Address normalization (ADD) =====
const US_STATE_ABBR = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA",
  MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT",
  NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
  OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",
  UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
  WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC"
};

function toIsoCountry(c) {
  if (!c) return "US";
  const s = String(c).trim().toUpperCase();
  if (s === "US" || s === "USA" || s.includes("UNITED STATES")) return "US";
  return s.length === 2 ? s : "US";
}
function toUsState(st) {
  if (!st) return "";
  const up = String(st).trim().toUpperCase();
  if (up.length === 2) return up;
  return US_STATE_ABBR[up] || up;
}
function toUsZip(z) {
  const m = String(z || "").match(/\d{5}(-?\d{4})?/);
  return m ? m[0].replace("-", "").slice(0, 9) : "";
}

// REPLACE your existing normAddr with this:
function normAddr(a = {}) {
  const line1 = a.line1 || a.address || "";
  const city = a.city || "";
  const stateRaw = a.state || a.stateCode || "";
  const zipRaw = a.postal_code || a.zipCode || a.zip || "";
  const countryRaw = a.country || "US";

  const country = toIsoCountry(countryRaw);
  const state = country === "US" ? toUsState(stateRaw) : stateRaw;
  const postal_code = country === "US" ? toUsZip(zipRaw) : String(zipRaw || "");

  return { line1, city, state, postal_code, country };
}

// Reserved reference words that Stripe blocks in Tax Calculations
const RESERVED_TAX_REFERENCES = new Set(["shipping"]);
function safeTaxRef(ref, fallback) {
  const v = String(ref || "").trim();
  if (!v || RESERVED_TAX_REFERENCES.has(v.toLowerCase())) return fallback;
  // (optional) keep it short
  return v.slice(0, 80);
}


// helpers (same file as routes or in a small util module)
function computeNextPollAt(status, attempts = 0) {
  // base cadence by status
  const baseHours =
    status === SHIPMENT_STATUS.OUT_FOR_DELIVERY ? 2 :
    status === SHIPMENT_STATUS.IN_TRANSIT ? 6 :
    status === SHIPMENT_STATUS.SHIPPED ? 12 :
    status === SHIPMENT_STATUS.EXCEPTION ? 12 : 12;

  // gentle backoff: +1h every 3 attempts, capped at 24h
  const extra = Math.min(24 - baseHours, Math.floor((attempts || 0) / 3));
  const hours = Math.min(baseHours + extra, 24);

  const t = new Date();
  t.setUTCHours(t.getUTCHours() + hours);
  return t;
}



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

    // Fire notification to the seller (artist)
    Notification.create({
      recipientUserId: artistUserId,     // seller
      actorUserId: req.user._id,         // buyer
      type: NOTIFICATION_TYPE.DELIVERY_DETAILS_SUBMITTED,
      title: "New order started",
      message: `A buyer submitted delivery details for “${artName}”.`,
      orderId: newOrder._id,
      imageId: imageId,
      data: { artName, artistName, price, imageLink },
    }).catch(err => console.error("Notif create error:", err));

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

// POST /orders/calculate-tax
router.post("/calculate-tax", async (req, res) => {
  try {
    const currency = (req.body.currency || "usd").toLowerCase();
    const base = Math.round(Number(req.body.base));        // cents
    const shipping = Math.round(Number(req.body.shipping || 0));
    const address = normAddr(req.body.address || {});

    if (!Number.isFinite(base) || base <= 0) {
      return res.status(400).json({ error: "Invalid base" });
    }
    if (!address.postal_code) {
      return res.status(400).json({ error: "postal_code required" });
    }

    // Build line_items (do not use "shipping" as reference)
    const line_items = [{ amount: base, reference: "artwork", tax_behavior: "exclusive" }];
    if (shipping > 0) {
      line_items.push({ amount: shipping, reference: "shipping_cost", tax_behavior: "exclusive" });
    }

    // Stripe Tax on the PLATFORM (no {stripeAccount})
    const calc = await stripe.tax.calculations.create({
      currency,
      line_items: [
        { amount: base, tax_behavior: "exclusive", reference: "artwork" },
        ...(shipping > 0
          ? [{ amount: shipping, tax_behavior: "exclusive", reference: "shipping_cost" }]
          : []),
      ],
      customer_details: { address, address_source: "shipping" },
    });

    const subtotal = base + shipping;
    const itemTax = calc.tax_amount_exclusive
      ?? calc.tax_amount_inclusive
      ?? (calc.amount_total - calc.amount_subtotal);
    const total = subtotal + itemTax;

    return res.json({ ok: true, currency, base, shipping, tax: itemTax, total });
  } catch (e) {
    console.error("calculate-tax error", e);
    // Soft fallback (return subtotal with 0 tax)
    const currency = (req.body.currency || "usd").toLowerCase();
    const base = Math.round(Number(req.body.base || 0));
    const shipping = Math.round(Number(req.body.shipping || 0));
    return res.status(200).json({
      ok: true,
      currency,
      base,
      shipping,
      tax: 0,
      total: base + shipping,
      note: "tax_fallback_error",
    });
  }
});


// POST /orders/create-payment-intent
// body: { sellerStripeId, base, shipping, address, platformFee (optional cents), orderId? }
router.post("/create-payment-intent", isUserAuthorized, async (req, res) => {
  try {
    const currency = "usd";
    const seller = String(req.body.sellerStripeId || "");
    const base = Math.round(Number(req.body.base));
    const shipping = Math.round(Number(req.body.shipping || 0));
    const platformFee = Math.round(Number(req.body.platformFee || 0));
    const address = normAddr(req.body.address || {});

    if (!seller) return res.status(400).json({ error: "sellerStripeId required" });
    if (!Number.isFinite(base) || base <= 0) return res.status(400).json({ error: "Invalid base" });
    if (!address.postal_code) return res.status(400).json({ error: "postal_code required" });

    // Recompute tax on the server (do not trust client)
    const line_items = [{ amount: base, reference: "artwork", tax_behavior: "exclusive" }];
    if (shipping > 0) {
      line_items.push({ amount: shipping, reference: "shipping_cost", tax_behavior: "exclusive" });
    }

    const calc = await stripe.tax.calculations.create({
      currency,
      line_items,
      customer_details: { address, address_source: "shipping" },
    });

    const tax = calc.tax_amount_exclusive
      ?? calc.tax_amount_inclusive
      ?? (calc.amount_total - calc.amount_subtotal);

    const total = base + shipping + tax;

    // Seller gets pre-tax share (minus optional platform fee)
    const sellerShare = Math.max(0, base + shipping - platformFee);

    const pi = await stripe.paymentIntents.create({
      amount: total,
      currency,
      // We precomputed tax; do NOT re-enable automatic tax
      automatic_tax: { enabled: false },
      transfer_data: {
        destination: seller,
        amount: sellerShare, // tax remains on the platform
      },
      ...(platformFee > 0 ? { application_fee_amount: platformFee } : {}),
      shipping: {
        name: address.name || req.user?.name || "Customer",
        address: {
          line1: address.line1,
          city: address.city,
          state: address.state,
          postal_code: address.postal_code,
          country: address.country,
        },
      },
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: req.body.orderId || "",
        base: String(base),
        shipping: String(shipping),
        tax: String(tax),
      },
    });

    return res.json({ clientSecret: pi.client_secret, total, tax, sellerShare, platformFee });
  } catch (e) {
    console.error("create-payment-intent error", e);
    return res.status(500).json({ error: "Internal Server Error" });
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
    const rawToken = getAuthToken(req);
    if (!rawToken) return res.status(401).json({ success: false, message: "No token found" });

    let decoded;
    try {
      decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const user = await UserModel.findById(decoded._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // If Stripe account exists, make a fresh onboarding link
    if (user.stripeAccountId) {
      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: process.env.STRIPE_REFRESH_URL || "https://immpression.com/stripe/reauth",
        return_url: process.env.STRIPE_RETURN_URL || "https://immpression.com/stripe/success",
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

    // Create account then link
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user.email,
      business_type: "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { app_user_id: String(user._id), username: user.userName || "NoName" },
    });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: process.env.STRIPE_REFRESH_URL || "https://immpression.com/stripe/reauth",
      return_url: process.env.STRIPE_RETURN_URL || "https://immpression.com/stripe/success",
      type: "account_onboarding",
    });

    user.stripeAccountId = account.id;
    await user.save();

    return res.status(200).json({
      success: true,
      data: accountLink,
      user: {
        _id: user._id,
        email: user.email,
        stripeAccountId: user.stripeAccountId,
        stripeOnboardingCompleted: user.stripeOnboardingCompleted,
      },
      message: "Stripe account created and onboarding link generated",
    });
  } catch (error) {
    console.error("❌ Error creating Stripe account:", error);
    return res.status(500).json({ success: false, message: "Stripe account creation failed", error: error.message });
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
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // looks like: whsec_...

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Optional: idempotency guard if you store processed event IDs
    // const already = await WebhookEventModel.findOne({ eventId: event.id });
    // if (already) return res.json({ received: true });

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const pi = event.data.object; // PaymentIntent
          const orderId = pi.metadata?.orderId;

          if (orderId) {
            await OrderModel.findOneAndUpdate(
              { _id: orderId },
              {
                status: "paid",
                paymentStatus: "paid",
                paymentIntentId: pi.id,
                paidAt: new Date(),
              }
            );

            try {
              const paidOrder = await OrderModel.findById(orderId).lean();
              if (paidOrder) {
                // Notify seller: payment received
                await Notification.create({
                  recipientUserId: paidOrder.artistUserId, // seller
                  actorUserId: paidOrder.userId,           // buyer
                  type: NOTIFICATION_TYPE.ORDER_PAID,
                  title: "Payment received",
                  message: `Payment confirmed for "${paidOrder.artName}".`,
                  orderId: paidOrder._id,
                  imageId: paidOrder.imageId,
                  data: {
                    artName: paidOrder.artName,
                    price: paidOrder.price,
                    imageLink: paidOrder.imageLink,
                  },
                });

                // Notify seller: needs shipping
                await Notification.create({
                  recipientUserId: paidOrder.artistUserId, // seller
                  actorUserId: paidOrder.userId,           // buyer
                  type: NOTIFICATION_TYPE.ORDER_NEEDS_SHIPPING,
                  title: "Action needed: Ship order",
                  message: `"${paidOrder.artName}" is paid and ready to ship. Add tracking info to notify the buyer.`,
                  orderId: paidOrder._id,
                  imageId: paidOrder.imageId,
                  data: {
                    artName: paidOrder.artName,
                    price: paidOrder.price,
                    imageLink: paidOrder.imageLink,
                  },
                });
              }
            } catch (nErr) {
              console.error("⚠️ Notification create error (paid):", nErr);
            }
          }
          break;
        }

        case "payment_intent.payment_failed": {
          const pi = event.data.object; // PaymentIntent
          const orderId = pi.metadata?.orderId;

          if (orderId) {
            await OrderModel.findOneAndUpdate(
              { _id: orderId },
              {
                status: "failed",
                paymentStatus: "failed",
                paymentIntentId: pi.id,
                failureReason: pi.last_payment_error?.message,
              }
            );
          }
          break;
        }

        case "charge.refunded": {
          const charge = event.data.object; // Charge
          const paymentIntentId = charge.payment_intent;

          if (paymentIntentId) {
            await OrderModel.findOneAndUpdate(
              { paymentIntentId },
              {
                status: "refunded",
                paymentStatus: "refunded",
                refundedAt: new Date(),
              }
            );
          }
          break;
        }

        // You can handle more event types here if needed:
        // case "account.updated":
        // case "payout.paid":
        // ...

        default:
          // For unhandled events, just acknowledge
          break;
      }

      // Optional: record processed event ID for idempotency
      // await WebhookEventModel.create({ eventId: event.id, type: event.type });

      return res.json({ received: true });
    } catch (err) {
      console.error("❌ Error processing webhook:", err);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

router.post("/check-stripe-status", async (req, res) => {
  try {
    const rawToken = getAuthToken(req);
    if (!rawToken) return res.status(401).json({ success: false, message: "No token found" });

    let decoded;
    try {
      decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const user = await UserModel.findById(decoded._id);
    if (!user || !user.stripeAccountId) {
      return res.status(400).json({ success: false, message: "No Stripe account found for this user" });
    }

    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    const { id: stripeAccountId, details_submitted, charges_enabled, payouts_enabled, requirements = {} } = account;
    const { currently_due = [], disabled_reason } = requirements;

    if (details_submitted && !user.stripeOnboardingCompleted) {
      user.stripeOnboardingCompleted = true;
      user.stripeOnboardingCompletedAt = new Date();
      await user.save();
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
        requirements: { currently_due, disabled_reason },
      },
    });
  } catch (error) {
    console.error("❌ Error checking Stripe account status:", error);
    return res.status(500).json({ success: false, message: "Failed to check Stripe account status" });
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


// ======================= FULL ENDPOINT: PATCH /order/:id/tracking ========================
router.patch("/order/:id/tracking", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber?.trim()) {
      return res.status(400).json({ success: false, message: "trackingNumber is required" });
    }
    const tn = trackingNumber.trim().toUpperCase();

    const order = await OrderModel.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (String(order.artistUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not allowed to modify this order" });
    }

    const carrierLc = String(carrier || "").toLowerCase();
    let status, events = [], titleCarrier;

    // ======== UPS BRANCH (direct API, mock allowed in non-prod for test numbers) ========
    if (carrierLc === "ups" || /^1Z[0-9A-Z]{16}$/.test(tn)) {
      try {
        const isProd = (process.env.UPS_ENV || "cie").toLowerCase() === "prod";
        const allowMock = !isProd && (process.env.UPS_ALLOW_TEST_NUMBERS || "").toLowerCase() === "true";
        const forceMock = !isProd && String(req.query.forceMock || "").trim() === "1";
        const usedMock = forceMock || (allowMock && isTestTrackingNumber(tn));

        const upsData = usedMock ? buildMockUpsTracking(tn) : await trackWithUPS(tn);
        const pkg = upsData?.trackResponse?.shipment?.[0]?.package?.[0];
        if (!pkg) {
          return res.status(400).json({ success: false, message: "UPS returned no package data." });
        }

        status = mapUpsStatus(pkg.currentStatus || {});
        const activities = Array.isArray(pkg?.activity) ? pkg.activity : [];
        events = activities.map((a) => {
          const dt = parseUpsDate(a?.date, a?.time);
          const locParts = [
            a?.activityLocation?.address?.city,
            a?.activityLocation?.address?.stateProvince,
            a?.activityLocation?.address?.country
          ].filter(Boolean);
          const event = {
            status: String(a?.status?.description || a?.activityLocation?.address?.city || "").toLowerCase(),
            message: a?.status?.description || a?.activityScan || "",
            location: locParts.join(", "),
          };
          if (dt) event.datetime = dt;
          return event;
        });
        titleCarrier = "UPS";

        // write shipping fields
        if (!order.shipping) order.shipping = {};
        order.shipping.trackingNumber = tn;
        order.shipping.carrier = titleCarrier;
        order.shipping.shipmentStatus = status;
        order.shipping.shippedAt = order.shipping.shippedAt || new Date();
        order.shipping.trackingEvents = events.filter(
          (e) => !("datetime" in e) || (e.datetime instanceof Date && !isNaN(e.datetime))
        );
        order.shipping.verified = order.shipping.verified || order.shipping.trackingEvents.length > 0;
        if (status === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
          order.shipping.deliveredAt = new Date();
        }

        // seed polling fields
        order.shipping.pollAttempts = 0;
        order.shipping.lastPolledAt = null;
        order.shipping.nextPollAt =
          status === SHIPMENT_STATUS.DELIVERED ? null : computeNextPollAt(status, 0);

        // notifications
        if (status === SHIPMENT_STATUS.DELIVERED) {
          Notification.create({
            recipientUserId: order.userId,
            actorUserId: order.artistUserId,
            type: NOTIFICATION_TYPE.ORDER_DELIVERED,
            title: "Delivered",
            message: `“${order.artName}” was delivered.`,
            orderId: order._id,
            imageId: order.imageId,
            data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
          }).catch(err => console.error("Notif create error:", err));
        }

        await order.save();

        // Always tell buyer it's shipped if we just attached tracking
        Notification.create({
          recipientUserId: order.userId,
          actorUserId: order.artistUserId,
          type: NOTIFICATION_TYPE.ORDER_SHIPPED,
          title: "Order shipped",
          message: `Your “${order.artName}” has been shipped via ${order.shipping.carrier}.`,
          orderId: order._id,
          imageId: order.imageId,
          data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
        }).catch(err => console.error("Notif create error:", err));

        return res.status(200).json({
          success: true,
          message: usedMock ? "Tracking saved (mock UPS data)." : "Tracking saved and verified with UPS.",
          data: { orderId: order._id, shipping: order.shipping },
        });
      } catch (e) {
        const code = e.status || 400;
        return res.status(code).json({ success: false, message: e.message || "UPS validation failed." });
      }
    }

    // =============================== FEDEX BRANCH (direct API) ===============================
    if (carrierLc === "fedex") {
      try {
        const fedex = await trackWithFedex(tn);
        const root = fedex?.output?.completeTrackResults?.[0]?.trackResults?.[0];
        if (!root) {
          return res.status(400).json({ success: false, message: "FedEx returned no track results." });
        }

        const latest = root?.latestStatusDetail || {};
        status = mapFedexStatus(latest);

        const scans = Array.isArray(root?.scanEvents) ? root.scanEvents : [];
        events = scans.map((ev) => {
          const dt = parseFedexDate(ev?.date || ev?.dateTime || ev?.eventDateTime);
          const addr = ev?.scanLocation || ev?.scanLocation?.address || ev?.location || {};
          const locParts = [
            addr?.city,
            addr?.stateOrProvinceCode,
            addr?.countryCode || addr?.countryName,
          ].filter(Boolean);
          const event = {
            status: String(ev?.eventDescription || ev?.derivedStatus || "").toLowerCase(),
            message: ev?.eventDescription || ev?.derivedStatus || latest?.description || "",
            location: locParts.join(", "),
          };
          if (dt) event.datetime = dt;
          return event;
        });
        titleCarrier = "FedEx";

        if (!order.shipping) order.shipping = {};
        order.shipping.trackingNumber = tn;
        order.shipping.carrier = titleCarrier;
        order.shipping.shipmentStatus = status;
        order.shipping.shippedAt = order.shipping.shippedAt || new Date();
        order.shipping.trackingEvents = events.filter(
          (e) => !("datetime" in e) || (e.datetime instanceof Date && !isNaN(e.datetime))
        );
        order.shipping.verified = order.shipping.verified || order.shipping.trackingEvents.length > 0;

        if (status === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
          const deliveredScan = scans.find(s => /delivered/i.test(s?.eventDescription || ""));
          order.shipping.deliveredAt = deliveredScan
            ? parseFedexDate(deliveredScan?.date || deliveredScan?.dateTime || deliveredScan?.eventDateTime) || new Date()
            : new Date();
        }

        // seed polling fields
        order.shipping.pollAttempts = 0;
        order.shipping.lastPolledAt = null;
        order.shipping.nextPollAt =
          status === SHIPMENT_STATUS.DELIVERED ? null : computeNextPollAt(status, 0);

        if (status === SHIPMENT_STATUS.DELIVERED) {
          Notification.create({
            recipientUserId: order.userId,
            actorUserId: order.artistUserId,
            type: NOTIFICATION_TYPE.ORDER_DELIVERED,
            title: "Delivered",
            message: `“${order.artName}” was delivered.`,
            orderId: order._id,
            imageId: order.imageId,
            data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
          }).catch(err => console.error("Notif create error:", err));
        }

        await order.save();

        Notification.create({
          recipientUserId: order.userId,
          actorUserId: order.artistUserId,
          type: NOTIFICATION_TYPE.ORDER_SHIPPED,
          title: "Order shipped",
          message: `Your “${order.artName}” has been shipped via ${order.shipping.carrier}.`,
          orderId: order._id,
          imageId: order.imageId,
          data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
        }).catch(err => console.error("Notif create error:", err));

        return res.status(200).json({
          success: true,
          message: "Tracking saved and verified with FedEx.",
          data: { orderId: order._id, shipping: order.shipping },
        });
      } catch (e) {
        const code = e.status || 400;
        return res.status(code).json({ success: false, message: e.message || "FedEx validation failed." });
      }
    }

    // ============================ AFTERSHIP FALLBACK (USPS/DHL/etc.) ============================
    let created;
    try {
      created = await axios.post(
        "https://api.aftership.com/v4/trackings",
        {
          tracking: {
            tracking_number: tn,
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

      if (created.status !== 409 && created.status >= 400) {
        const msg =
          created.data?.meta?.message ||
          created.data?.meta?.error?.type ||
          "Invalid or unsupported tracking number.";
        return res.status(400).json({ success: false, message: msg });
      }
    } catch {
      return res.status(400).json({ success: false, message: "Tracking validation failed." });
    }

    const slugForGet = (carrier ? String(carrier).toLowerCase() : "auto");
    const fetched = await axios.get(
      `https://api.aftership.com/v4/trackings/${slugForGet}/${encodeURIComponent(tn)}`,
      { headers: { "aftership-api-key": process.env.AFTERSHIP_API_KEY } }
    );

    const t = fetched.data?.data?.tracking;
    if (!t) {
      return res.status(400).json({ success: false, message: "Unable to retrieve tracking details." });
    }

    status = mapStatus(t.tag || t.subtag || t.status);
    titleCarrier = toTitleCaseCarrier(t.slug || carrier);

    if (!order.shipping) order.shipping = {};
    order.shipping.trackingNumber = tn;
    order.shipping.carrier = titleCarrier;
    order.shipping.shipmentStatus = status;
    order.shipping.shippedAt = order.shipping.shippedAt || new Date();
    order.shipping.aftershipTrackingId = t.id;

    const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
    events = checkpoints.map((c) => {
      const dt = c.checkpoint_time ? new Date(c.checkpoint_time) : undefined;
      const event = {
        status: String(c.tag || c.subtag || c.status || "").toLowerCase(),
        message: c.message || c.checkpoint_message,
        location: [c.city, c.state, c.country_name].filter(Boolean).join(", "),
      };
      if (dt && !isNaN(dt)) event.datetime = dt;
      return event;
    });

    order.shipping.trackingEvents = events;
    order.shipping.verified = order.shipping.verified || order.shipping.trackingEvents.length > 0;
    if (status === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
      order.shipping.deliveredAt = new Date();
    }

    // seed polling fields
    order.shipping.pollAttempts = 0;
    order.shipping.lastPolledAt = null;
    order.shipping.nextPollAt =
      status === SHIPMENT_STATUS.DELIVERED ? null : computeNextPollAt(status, 0);

    await order.save();

    // (Optional) notify shipped (kept same behavior as your original)
    Notification.create({
      recipientUserId: order.userId,
      actorUserId: order.artistUserId,
      type: NOTIFICATION_TYPE.ORDER_SHIPPED,
      title: "Order shipped",
      message: `Your “${order.artName}” has been shipped via ${order.shipping.carrier}.`,
      orderId: order._id,
      imageId: order.imageId,
      data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
    }).catch(err => console.error("Notif create error:", err));

    if (status === SHIPMENT_STATUS.DELIVERED) {
      Notification.create({
        recipientUserId: order.userId,
        actorUserId: order.artistUserId,
        type: NOTIFICATION_TYPE.ORDER_DELIVERED,
        title: "Delivered",
        message: `“${order.artName}” was delivered.`,
        orderId: order._id,
        imageId: order.imageId,
        data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
      }).catch(err => console.error("Notif create error:", err));
    }

    return res.status(200).json({
      success: true,
      message: "Tracking saved and verified.",
      data: { orderId: order._id, shipping: order.shipping },
    });
  } catch (error) {
    console.error("Error verifying/saving tracking:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
// =========================================================================================





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

router.get("/ups/ping", async (req, res) => {
  try {
    const token = await getUpsToken();
    return res.json({
      ok: true,
      tokenPreview: token ? token.slice(0, 16) + "…" : null,
      env: process.env.UPS_ENV,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/fedex/ping", async (req, res) => {
  try {
    const token = await getFedexToken();
    res.json({ ok: true, tokenPreview: token ? token.slice(0, 16) + "…" : null, env: process.env.FEDEX_ENV });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// List MY SALES (orders where I'm the seller/artist)
router.get("/my-sales", isUserAuthorized, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const statusFilter = (req.query.status || "").trim();
    const query = { artistUserId: req.user._id };
    if (statusFilter) {
      query.$or = [
        { status: new RegExp(`^${statusFilter}$`, "i") },
        { "shipping.shipmentStatus": new RegExp(`^${statusFilter}$`, "i") }
      ];
    }

    const sales = await OrderModel.find(query)
      .populate("imageId", "imageLink")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalSales = await OrderModel.countDocuments(query);

    const enriched = sales.map((o) => {
      const shipping = o.shipping || {};
      const buyerFriendly =
        o.userAccountName ||
        (o.userId && typeof o.userId === "object" && (o.userId.name || o.userId.userName)) ||
        "Buyer";

      return {
        ...o,
        imageLink: o.imageId?.imageLink || "https://via.placeholder.com/50",
        buyerName: buyerFriendly,
        // normalized tracking info for the UI
        tracking: {
          trackingNumber: shipping.trackingNumber || null,
          carrier: shipping.carrier || null,
          shipmentStatus: shipping.shipmentStatus || o.status || "processing",
          shippedAt: shipping.shippedAt || null,
          deliveredAt: shipping.deliveredAt || null,
          trackingEvents: shipping.trackingEvents || [],
        },
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalSales / limit),
        totalSales,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching my sales:", error);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

/**
 * POST /shipping/ups-rates
 * body: {
 *   // One of:
 *   artistUserId?: string,
 *   shipFromZip?: string,
 *
 *   shipTo: { postalCode: string, countryCode?: "US", stateCode?: string, city?: string, residential?: boolean },
 *   parcel: { weightLb: number, lengthIn: number, widthIn: number, heightIn: number },
 *   serviceCodes?: string[] // optional filter, e.g. ["03","02"] (Ground, 2nd Day Air)
 * }
 */
router.post("/shipping/ups-rates", async (req, res) => {
  try {
    const {
      artistUserId,
      shipFromZip,
      shipTo = {},
      parcel = {},
      serviceCodes = []
    } = req.body || {};

    // 1) Resolve ship-from ZIP (from user.zipcode or raw shipFromZip)
    let fromZip = String(shipFromZip || "").trim();
    if (!fromZip && artistUserId) {
      const seller = await UserModel.findById(artistUserId).lean();
      if (!seller || !seller.zipcode) {
        return res.status(400).json({ success: false, error: "Seller zipcode not found" });
      }
      fromZip = seller.zipcode;
    }
    if (!fromZip) {
      return res.status(400).json({ success: false, error: "shipFromZip or artistUserId required" });
    }

    // 2) Basic validation for ship-to + parcel
    const toZip = String(shipTo.postalCode || "").trim();
    if (!toZip) return res.status(400).json({ success: false, error: "shipTo.postalCode required" });

    const weight = Number(parcel.weightLb || 0);
    const length = Number(parcel.lengthIn || 0);
    const width = Number(parcel.widthIn || 0);
    const height = Number(parcel.heightIn || 0);
    if (!(weight > 0 && length > 0 && width > 0 && height > 0)) {
      return res.status(400).json({ success: false, error: "parcel must include positive weightLb, lengthIn, widthIn, heightIn" });
    }

    // 3) Build UPS Rating request (REST v2403)
    const token = await getUpsTokenWithScopes(["rating"]); // important!

    const apiBase = (process.env.UPS_ENV || "cie").toLowerCase() === "prod"
      ? "https://onlinetools.ups.com"
      : "https://wwwcie.ups.com";

    // Optional: include ShipperNumber for negotiated rates
    const shipperNumber = (process.env.UPS_SHIPPER_NUMBER || "").trim();

    const body = {
      RateRequest: {
        Request: { TransactionReference: { CustomerContext: "Immpression Rate Quote" } },
        Shipment: {
          Shipper: {
            ...(shipperNumber ? { ShipperNumber: shipperNumber } : {}),
            Address: {
              PostalCode: fromZip.slice(0, 5),
              CountryCode: shipTo.countryCode || "US"
            }
          },
          ShipTo: {
            Address: {
              PostalCode: toZip.slice(0, 5),
              CountryCode: shipTo.countryCode || "US",
              ...(shipTo.stateCode ? { StateProvinceCode: shipTo.stateCode } : {}),
              ...(shipTo.city ? { City: shipTo.city } : {}),
              ResidentialAddressIndicator: shipTo.residential === true ? "" : undefined
            }
          },
          // If you want rates for ALL services, omit Service.
          // If you want to restrict, you can loop serviceCodes and make multiple calls,
          // but UPS accepts Service per request. For simplicity we omit here.

          Package: [{
            PackagingType: { Code: "02" }, // Customer-supplied package
            Dimensions: {
              UnitOfMeasurement: { Code: "IN" },
              Length: String(length),
              Width: String(width),
              Height: String(height)
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: "LBS" },
              Weight: String(weight)
            }
          }],

          // Ask UPS to include time-in-transit with rates:
          DeliveryTimeInformation: { PackageBillType: "03" } // 03 = Non Document
        },
        // Get both list & negotiated if available:
        AdditionalInfo: { ReturnTransitTimes: "Y", NegotiatedRatesIndicator: shipperNumber ? "Y" : undefined }
      }
    };

    const resp = await axios.post(`${apiBase}/api/rating/v2403/Rate`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      validateStatus: () => true
    });

    if (resp.status >= 400) {
      return res.status(resp.status).json({
        success: false,
        error: resp.data?.response?.errors?.[0]?.message || "UPS rating failed",
        raw: resp.data
      });
    }

    // 4) Normalize response
    const rated = resp.data?.RateResponse?.RatedShipment || [];
    const rows = (Array.isArray(rated) ? rated : [rated]).filter(Boolean).map(r => {
      const serviceCode = r?.Service?.Code || null;
      const serviceDesc = r?.Service?.Description || null;

      // total charges (negotiated preferred, fallback published)
      const negotiated = r?.NegotiatedRateCharges?.TotalCharge;
      const published = r?.TotalCharges;
      const money = negotiated?.MonetaryValue || published?.MonetaryValue || null;
      const currency = negotiated?.CurrencyCode || published?.CurrencyCode || "USD";

      // time-in-transit
      const days =
        Number(r?.GuaranteedDelivery?.BusinessDaysInTransit) ||
        Number(r?.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit) ||
        null;

      return {
        carrier: "UPS",
        serviceCode,
        serviceName: serviceDesc || serviceCode,
        amount: money ? Number(money) : null,
        currency,
        estBusinessDays: days,
      };
    }).filter(x => x.amount !== null);

    // Optional filter by desired services
    const filtered = serviceCodes.length
      ? rows.filter(r => serviceCodes.includes(r.serviceCode))
      : rows;

    // Picks
    const cheapest = filtered.length ? [...filtered].sort((a, b) => a.amount - b.amount)[0] : null;
    const fastest = filtered.length ? [...filtered].sort((a, b) => (a.estBusinessDays || 99) - (b.estBusinessDays || 99))[0] : null;

    return res.json({
      success: true,
      rates: filtered,
      picks: { cheapest, fastest }
    });
  } catch (err) {
    console.error("UPS rates error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal Server Error" });
  }
});

// ===== SHIPPING QUOTE FOR AN ORDER (UPS) =====
// GET /order/:id/shipping-quote?services=03,02,12&debug=1
router.get("/order/:id/shipping-quote", isUserAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const debug = String(req.query.debug || "").trim() === "1";

    const order = await OrderModel.findById(id).lean();
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    // Only buyer or seller can quote
    const isBuyer = String(order.userId) === String(req.user._id);
    const isSeller = String(order.artistUserId) === String(req.user._id);
    if (!isBuyer && !isSeller) return res.status(403).json({ success: false, error: "Not allowed" });

    // Resolve ship-from ZIP from seller profile
    const artist = await UserModel.findById(order.artistUserId).lean();
    const fromZipRaw = artist?.zipcode || "";
    const toZipRaw = order?.deliveryDetails?.zipCode || "";

    // Sanitize ZIPs to 5-digit
    const five = (z) => (String(z || "").match(/\d{5}/)?.[0] || "").slice(0, 5);
    const fromZip = five(fromZipRaw);
    const toZip = five(toZipRaw);

    if (!fromZip) return res.status(400).json({ success: false, error: "Seller zipcode missing/invalid" });
    if (!toZip) return res.status(400).json({ success: false, error: "Order delivery ZIP missing/invalid" });

    // TEMP: default parcel (replace with real listing dims/weight)
    const parcel = {
      weightLb: 5,
      lengthIn: 20,
      widthIn: 16,
      heightIn: 4,
    };
    const weight = String(Math.max(0.1, Number(parcel.weightLb)));
    const length = String(Math.max(1, Number(parcel.lengthIn)));
    const width = String(Math.max(1, Number(parcel.widthIn)));
    const height = String(Math.max(1, Number(parcel.heightIn)));

    // Env + token
    const isProd = (process.env.UPS_ENV || "cie").toLowerCase() === "prod";
    const apiBase = isProd ? "https://onlinetools.ups.com" : "https://wwwcie.ups.com";
    const token = await getUpsTokenWithScopes(["rating"]);

    // Use ShipperNumber only in prod (negotiated rates)
    const shipperNumber = isProd ? (process.env.UPS_SHIPPER_NUMBER || "").trim() : "";

    // Services to rate
    const serviceCodes =
      String(req.query.services || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    const servicesToTry = serviceCodes.length ? serviceCodes : ["03"]; // 03 = UPS Ground

    const buildRateBody = (serviceCode) => ({
      RateRequest: {
        Request: { TransactionReference: { CustomerContext: "Immpression Order Quote" } },
        Shipment: {
          PickupType: { Code: "01" }, // 01=Daily pickup

          Shipper: {
            ...(shipperNumber ? { ShipperNumber: shipperNumber } : {}),
            Address: {
              PostalCode: fromZip,
              CountryCode: "US",
            },
          },
          ShipFrom: {
            Address: {
              PostalCode: fromZip,
              CountryCode: "US",
            },
          },
          ShipTo: {
            Address: {
              PostalCode: toZip,
              CountryCode: "US",
              ResidentialAddressIndicator: "", // treat as residential
            },
          },

          Service: { Code: serviceCode },

          Package: [{
            PackagingType: { Code: "02" }, // customer-supplied
            Dimensions: {
              UnitOfMeasurement: { Code: "IN" },
              Length: length,
              Width: width,
              Height: height,
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: "LBS" },
              Weight: weight,
            },
          }],
        },
        AdditionalInfo: {
          ReturnTransitTimes: "Y",
          NegotiatedRatesIndicator: shipperNumber ? "Y" : undefined,
        },
      },
    });

    const results = await Promise.allSettled(
      servicesToTry.map(async (svc) => {
        const body = buildRateBody(svc);
        const resp = await axios.post(`${apiBase}/api/rating/v2403/Rate`, body, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          validateStatus: () => true,
        });

        if (resp.status >= 400) {
          const upsErr =
            resp.data?.response?.errors?.[0] ||
            resp.data?.response?.Errors?.Error?.[0] ||
            resp.data?.Fault ||
            resp.data;
          console.error("UPS Rating error:", JSON.stringify(upsErr, null, 2), {
            fromZip, toZip, env: process.env.UPS_ENV, service: svc, usedShipperNumber: Boolean(shipperNumber),
          });
          throw {
            code: upsErr?.code || upsErr?.Code || String(resp.status),
            message: upsErr?.message || upsErr?.responseStatus?.description || "UPS rating failed",
            service: svc,
          };
        }

        // Normalize one response
        const rated = resp.data?.RateResponse?.RatedShipment || [];
        const rows = (Array.isArray(rated) ? rated : [rated]).filter(Boolean).map((r) => {
          const serviceCode = r?.Service?.Code || svc;
          const serviceName = r?.Service?.Description || serviceCode;

          const published = r?.TotalCharges || r?.ShipmentTotalCharges; // some tenants use ShipmentTotalCharges
          const negotiated = r?.NegotiatedRateCharges?.TotalCharge;

          // Keep both list & negotiated, select best available
          const listAmount = published?.MonetaryValue != null ? parseFloat(published.MonetaryValue) : null;
          const negotiatedAmount = negotiated?.MonetaryValue != null ? parseFloat(negotiated.MonetaryValue) : null;
          const listCurrency = published?.CurrencyCode || "USD";
          const negotiatedCurrency = negotiated?.CurrencyCode || listCurrency;

          // choose negotiated if present, else list
          const amount = negotiatedAmount ?? listAmount;
          const currency = negotiatedAmount != null ? negotiatedCurrency : listCurrency;

          const days =
            Number(r?.GuaranteedDelivery?.BusinessDaysInTransit) ||
            Number(r?.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit) ||
            null;

          return {
            carrier: "UPS",
            serviceCode,
            serviceName,
            // main price used by UI:
            amount: typeof amount === "number" && !Number.isNaN(amount) ? amount : null,
            currency,
            // extras so you can compare in UI if desired:
            listAmount,
            negotiatedAmount,
            estBusinessDays: days,
            _rawLite: debug ? { // tiny debug subset; avoids massive payloads
              Money: { list: published, negotiated: r?.NegotiatedRateCharges },
              Codes: { serviceCode },
            } : undefined,
          };
        });

        return rows;
      })
    );

    const rates = [];
    const serviceErrors = [];
    for (const r of results) {
      if (r.status === "fulfilled") rates.push(...r.value);
      else serviceErrors.push(r.reason);
    }

    // Keep only rows that have a real > 0 price
    const priced = rates.filter(x => typeof x.amount === "number" && x.amount > 0);

    if (!priced.length) {
      // If nothing priced, surface error instead of sending $0
      return res.status(400).json({
        success: false,
        error: "No billable UPS rate returned for this shipment.",
        details: {
          fromZip, toZip, env: process.env.UPS_ENV,
          servicesTried: servicesToTry,
          serviceErrors: serviceErrors.length ? serviceErrors : undefined,
          hint: "Check parcel weight/dims, PickupType/Service, and ZIPs. In CIE, avoid ShipperNumber.",
          debugRaw: debug ? "Enable server logs to inspect full UPS payload." : undefined,
        },
      });
    }

    const cheapest = [...priced].sort((a, b) => a.amount - b.amount)[0];
    const fastest = [...priced].sort((a, b) => (a.estBusinessDays ?? 999) - (b.estBusinessDays ?? 999))[0];

    return res.json({
      success: true,
      parcelDefaultsUsed: parcel,
      rates: priced,
      picks: { cheapest, fastest },
      partialErrors: serviceErrors.length ? serviceErrors : undefined,
      meta: debug ? { fromZip, toZip, env: process.env.UPS_ENV, servicesTried: servicesToTry } : undefined,
    });
  } catch (err) {
    console.error("shipping-quote error:", err?.response?.data || err);
    return res.status(500).json({ success: false, error: err.message || "Internal Server Error" });
  }
});

router.post("/tax/preview", isUserAuthorized, async (req, res) => {
  try {
    let artistStripeId, address, items = [], shippingAmt = 0;
    const currency = "usd";

    if (req.body.orderId) {
      const order = await OrderModel.findById(req.body.orderId).lean();
      if (!order) return res.status(404).json({ error: "Order not found" });

      const artist = await UserModel.findById(order.artistUserId).lean();
      if (!artist?.stripeAccountId) return res.status(400).json({ error: "Artist not connected to Stripe" });
      artistStripeId = artist.stripeAccountId;

      address = normAddr(order.deliveryDetails);
      items = [{
        amount: cents(order.price),
        quantity: 1,
        reference: `order:${order._id}`,
        tax_behavior: "exclusive",
      }];

      const ship = Number(order.deliveryDetails?.shippingCost || 0);
      shippingAmt = cents(ship);
    } else {
      const { artistUserId, imageId, address: addr, items: rawItems = [], shipping } = req.body;

      let artistId = artistUserId;
      if (!artistId && imageId) {
        const img = await ImageModel.findById(imageId).lean();
        artistId = img?.userId;
      }
      const artist = artistId ? await UserModel.findById(artistId).lean() : null;
      if (!artist?.stripeAccountId) return res.status(400).json({ error: "Artist not connected to Stripe" });
      artistStripeId = artist.stripeAccountId;

      address = normAddr(addr || {});
      items = rawItems.map((it, i) => ({
        amount: cents(it.amount),
        quantity: Math.max(1, Number(it.quantity || 1)),
        reference: safeTaxRef(it.reference, `item_${i + 1}`), // sanitize
        tax_code: it.tax_code,
        tax_behavior: it.tax_behavior || "exclusive",
      }));
      shippingAmt = cents(shipping?.amount || 0);
    }

    if (!address?.postal_code) return res.status(400).json({ error: "Destination postal_code required" });
    if (!items.length) return res.status(400).json({ error: "No items to tax" });

    // 1) Items
    const calc = await stripe.tax.calculations.create({
      currency,
      line_items: items.map(li => ({
        amount: li.amount,
        quantity: li.quantity,
        reference: li.reference,
        tax_code: li.tax_code,
        tax_behavior: li.tax_behavior || "exclusive",
      })),
      customer_details: { address, address_source: "shipping" },
      expand: ["line_items.data.tax_breakdown", "tax_breakdown"],
    }, { stripeAccount: artistStripeId });

    // 2) Shipping as its own line (avoid reserved "shipping")
    let shippingTax = { amount: 0, tax_breakdown: [] };
    if (shippingAmt > 0) {
      const calcShip = await stripe.tax.calculations.create({
        currency,
        line_items: [{ amount: shippingAmt, reference: "shipping_cost", tax_behavior: "exclusive" }],
        customer_details: { address, address_source: "shipping" },
        expand: ["tax_breakdown"],
      }, { stripeAccount: artistStripeId });

      shippingTax = {
        amount: calcShip.tax_amount_exclusive
          ?? calcShip.tax_amount_inclusive
          ?? (calcShip.amount_total - shippingAmt),
        tax_breakdown: calcShip.tax_breakdown || [],
      };
    }

    const itemTax = calc.tax_amount_exclusive
      ?? calc.tax_amount_inclusive
      ?? (calc.amount_total - calc.amount_subtotal);

    const subtotal = items.reduce((s, it) => s + it.amount * it.quantity, 0);
    const taxTotal = itemTax + shippingTax.amount;
    const total = subtotal + shippingAmt + taxTotal;

    return res.json({
      ok: true,
      currency,
      breakdown: { subtotal, shipping: shippingAmt, tax: taxTotal, total },
      item_tax_breakdown: calc.tax_breakdown || [],
      shipping_tax_breakdown: shippingTax.tax_breakdown || [],
    });
  } catch (err) {
    console.error("tax/preview error:", err);
    return res.status(500).json({ error: "Tax preview failed" });
  }
});


// --- CRON GUARD + HANDLER ---
function pollDueGuard(req, res, next) {
  const headerSecret = req.headers["x-cron-secret"];
  const querySecret = req.query.secret;
  const required = process.env.CRON_SECRET;

  if (required && headerSecret !== required && querySecret !== required) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  next();
}

async function pollDueHandler(req, res) {
  try {
    const now = new Date();
    const due = await OrderModel.find({
      "shipping.trackingNumber": { $exists: true, $ne: null },
      "shipping.shipmentStatus": { $ne: SHIPMENT_STATUS.DELIVERED },
      $or: [
        { "shipping.nextPollAt": { $lte: now } },
        { "shipping.nextPollAt": { $exists: false } }
      ]
    })
    .sort({ "shipping.nextPollAt": 1 })
    .limit(50);

    const results = [];
    const MAX_ATTEMPTS = 120;

    for (const order of due) {
      const tn = order.shipping?.trackingNumber;
      const carrierName = String(order.shipping?.carrier || "").toLowerCase();
      const prevStatus = order.shipping?.shipmentStatus || null;
      const attempts = order.shipping?.pollAttempts || 0;

      try {
        let newStatus = prevStatus;
        let newEvents = order.shipping?.trackingEvents || [];

        if (carrierName === "ups" || /^1Z[0-9A-Z]{16}$/.test(tn)) {
          const data = await trackWithUPS(tn);
          const pkg = data?.trackResponse?.shipment?.[0]?.package?.[0];
          if (!pkg) throw new Error("UPS: no package data");
          newStatus = mapUpsStatus(pkg.currentStatus || {});
          const acts = Array.isArray(pkg.activity) ? pkg.activity : [];
          newEvents = acts.map(a => {
            const dt = parseUpsDate(a?.date, a?.time);
            const loc = [a?.activityLocation?.address?.city, a?.activityLocation?.address?.stateProvince, a?.activityLocation?.address?.country]
              .filter(Boolean).join(", ");
            const ev = {
              status: String(a?.status?.description || "").toLowerCase(),
              message: a?.status?.description || a?.activityScan || "",
              location: loc,
            };
            if (dt) ev.datetime = dt;
            return ev;
          }).filter(e => !("datetime" in e) || (e.datetime instanceof Date && !isNaN(e.datetime)));
          if (newStatus === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
            order.shipping.deliveredAt = new Date();
          }
        } else if (carrierName === "fedex") {
          const fedex = await trackWithFedex(tn);
          const root = fedex?.output?.completeTrackResults?.[0]?.trackResults?.[0];
          if (!root) throw new Error("FedEx: no track results");
          const latest = root?.latestStatusDetail || {};
          newStatus = mapFedexStatus(latest);
          const scans = Array.isArray(root?.scanEvents) ? root.scanEvents : [];
          newEvents = scans.map(ev => {
            const dt = parseFedexDate(ev?.date || ev?.dateTime || ev?.eventDateTime);
            const addr = ev?.scanLocation || ev?.scanLocation?.address || ev?.location || {};
            const loc = [addr?.city, addr?.stateOrProvinceCode, addr?.countryCode || addr?.countryName]
              .filter(Boolean).join(", ");
            const e = {
              status: String(ev?.eventDescription || ev?.derivedStatus || "").toLowerCase(),
              message: ev?.eventDescription || ev?.derivedStatus || latest?.description || "",
              location: loc,
            };
            if (dt) e.datetime = dt;
            return e;
          }).filter(e => !("datetime" in e) || (e.datetime instanceof Date && !isNaN(e.datetime)));
          if (newStatus === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
            const deliveredScan = scans.find(s => /delivered/i.test(s?.eventDescription || ""));
            order.shipping.deliveredAt = deliveredScan
              ? parseFedexDate(deliveredScan?.date || deliveredScan?.dateTime || deliveredScan?.eventDateTime) || new Date()
              : new Date();
          }
        } else {
          const slug = carrierName || "auto";
          const fetched = await axios.get(
            `https://api.aftership.com/v4/trackings/${slug}/${encodeURIComponent(tn)}`,
            { headers: { "aftership-api-key": process.env.AFTERSHIP_API_KEY } }
          );
          const t = fetched.data?.data?.tracking;
          if (!t) throw new Error("AfterShip: no tracking");
          newStatus = mapStatus(t.tag || t.subtag || t.status);
          const cps = Array.isArray(t.checkpoints) ? t.checkpoints : [];
          newEvents = cps.map(c => {
            const dt = c.checkpoint_time ? new Date(c.checkpoint_time) : undefined;
            const ev = {
              status: String(c.tag || c.subtag || c.status || "").toLowerCase(),
              message: c.message || c.checkpoint_message,
              location: [c.city, c.state, c.country_name].filter(Boolean).join(", "),
            };
            if (dt && !isNaN(dt)) ev.datetime = dt;
            return ev;
          });
          if (newStatus === SHIPMENT_STATUS.DELIVERED && !order.shipping.deliveredAt) {
            order.shipping.deliveredAt = new Date();
          }
        }

        order.shipping.trackingEvents = newEvents;
        order.shipping.shipmentStatus = newStatus;
        order.shipping.lastPolledAt = new Date();
        order.shipping.pollAttempts = attempts + 1;

        const shouldStop =
          newStatus === SHIPMENT_STATUS.DELIVERED ||
          order.shipping.pollAttempts >= MAX_ATTEMPTS;

        order.shipping.nextPollAt = shouldStop
          ? null
          : computeNextPollAt(newStatus, order.shipping.pollAttempts);

        if (prevStatus !== newStatus) {
          if (newStatus === SHIPMENT_STATUS.OUT_FOR_DELIVERY) {
            Notification.create({
              recipientUserId: order.userId,
              actorUserId: order.artistUserId,
              type: NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY,
              title: "Out for delivery",
              message: `“${order.artName}” is out for delivery.`,
              orderId: order._id, imageId: order.imageId,
              data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
            }).catch(()=>{});
          }
          if (newStatus === SHIPMENT_STATUS.DELIVERED) {
            Notification.create({
              recipientUserId: order.userId,
              actorUserId: order.artistUserId,
              type: NOTIFICATION_TYPE.ORDER_DELIVERED,
              title: "Delivered",
              message: `“${order.artName}” was delivered.`,
              orderId: order._id, imageId: order.imageId,
              data: { artName: order.artName, price: order.price, imageLink: order.imageLink },
            }).catch(()=>{});
          }
        }

        await order.save();

        results.push({
          orderId: String(order._id),
          from: prevStatus,
          to: newStatus,
          attempts: order.shipping.pollAttempts,
          nextPollAt: order.shipping.nextPollAt,
        });
      } catch (e) {
        results.push({ orderId: String(order._id), error: e.message || String(e) });
      }
    }

    return res.json({ ok: true, processed: due.length, results });
  } catch (e) {
    console.error("poll-due error", e);
    return res.status(500).json({ ok: false, error: "poll failed" });
  }
}

// Expose both POST and GET so Vercel Cron (GET) works
router.post("/orders/shipments/poll-due", pollDueGuard, pollDueHandler);
router.get("/orders/shipments/poll-due", pollDueGuard, pollDueHandler);



export default router;
