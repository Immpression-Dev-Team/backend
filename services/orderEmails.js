import sendEmail from "./email.js";
import UserModel from "../models/users.js";
import { FULFILLMENT_TYPE } from "../models/images.js";

const money = (cents) => `$${(Math.max(0, Number(cents || 0)) / 100).toFixed(2)}`;

// Fire-and-forget wrapper — a failed email must never break payment
// confirmation, matching the pattern used by services/adminNotify.js.
async function safeSend(to, subject, html) {
  if (!to) return;
  try {
    await sendEmail(to, subject, html);
  } catch (err) {
    console.error(`[orderEmails] Failed to email ${to}:`, err?.message || err);
  }
}

export async function sendBuyerPaidEmail(order) {
  const buyer = await UserModel.findById(order.userId).select("email name").lean();
  if (!buyer?.email) return;

  const html = `
    <p>Hi ${buyer.name || "there"},</p>
    <p>Thanks for your purchase! You bought <strong>"${order.artName}"</strong> for ${money(order.totalAmount)}.</p>
    ${order.fulfillmentType === FULFILLMENT_TYPE.PRINT_ON_DEMAND
      ? `<p>This is a Print on Demand piece — Immpression will print and ship it. We'll email you again once it ships.</p>`
      : `<p>We'll notify you as soon as the artist ships it.</p>`}
  `;
  await safeSend(buyer.email, `You purchased "${order.artName}"`, html);
}

export async function sendSellerPaidEmail(order) {
  const artist = await UserModel.findById(order.artistUserId).select("email name").lean();
  if (!artist?.email) return;

  const html =
    order.fulfillmentType === FULFILLMENT_TYPE.PRINT_ON_DEMAND
      ? `
        <p>Hi ${artist.name || "there"},</p>
        <p>Great news — <strong>"${order.artName}"</strong> just sold for ${money(order.baseAmount)}.</p>
        <p>Since this is a Print on Demand piece, Immpression handles printing and shipping — there's nothing for you to do.
        You'll be paid automatically 10 days after it ships.</p>
      `
      : `
        <p>Hi ${artist.name || "there"},</p>
        <p>Great news — <strong>"${order.artName}"</strong> just sold for ${money(order.baseAmount)}.</p>
        <p>Please ship it and add tracking info in the app so the buyer (and you) can follow delivery — you'll be paid automatically once it's delivered.</p>
      `;
  await safeSend(artist.email, `"${order.artName}" sold!`, html);
}
