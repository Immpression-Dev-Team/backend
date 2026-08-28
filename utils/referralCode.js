import crypto from "crypto";
import Referral from "../models/referral.js";

// Excludes visually ambiguous characters (0/O, 1/l/I).
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 10;

function randomCode(length = CODE_LENGTH) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

export async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomCode();
    const exists = await Referral.findOne({
      $or: [{ code }, { previousCodes: code }],
    });
    if (!exists) return code;
  }
  throw new Error("Failed to generate a unique referral code after multiple attempts");
}
