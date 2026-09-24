// Address normalization shared by order checkout (Stripe Tax) and
// Print on Demand fulfillment (Prodigi), which both need a consistent
// ISO country code / US state abbreviation / zip shape from whatever a
// client sent in deliveryDetails.

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

export function toIsoCountry(c) {
  if (!c) return "US";
  const s = String(c).trim().toUpperCase();
  if (s === "US" || s === "USA" || s.includes("UNITED STATES")) return "US";
  return s.length === 2 ? s : "US";
}
export function toUsState(st) {
  if (!st) return "";
  const up = String(st).trim().toUpperCase();
  if (up.length === 2) return up;
  return US_STATE_ABBR[up] || up;
}
export function toUsZip(z) {
  const m = String(z || "").match(/\d{5}(-?\d{4})?/);
  return m ? m[0].replace("-", "").slice(0, 9) : "";
}

export function normAddr(a = {}) {
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
