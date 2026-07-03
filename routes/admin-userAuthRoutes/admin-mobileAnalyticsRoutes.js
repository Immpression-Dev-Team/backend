// routes/admin-userAuthRoutes/admin-mobileAnalyticsRoutes.js
// AdMob Reporting API — 30-day network report (earnings, impressions, clicks, eCPM)
// Required env vars:
//   ADMOB_PUBLISHER_ID    — e.g. "pub-8886964376457193"
//   ADMOB_CLIENT_ID       — OAuth Desktop client ID
//   ADMOB_CLIENT_SECRET   — OAuth Desktop client secret
//   ADMOB_REFRESH_TOKEN   — long-lived refresh token (from get-admob-token.mjs)

import express from "express";
import { isAdminAuthorized } from "../../utils/authUtils.js";

const router = express.Router();

async function getAccessToken() {
  const { ADMOB_CLIENT_ID, ADMOB_CLIENT_SECRET, ADMOB_REFRESH_TOKEN } = process.env;
  if (!ADMOB_CLIENT_ID || !ADMOB_CLIENT_SECRET || !ADMOB_REFRESH_TOKEN) {
    throw new Error("ADMOB_CLIENT_ID / ADMOB_CLIENT_SECRET / ADMOB_REFRESH_TOKEN not set");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     ADMOB_CLIENT_ID,
      client_secret: ADMOB_CLIENT_SECRET,
      refresh_token: ADMOB_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || "Failed to get AdMob access token");
  return data.access_token;
}

function dateObj(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

async function generateReport(publisherId, token, reportSpec) {
  const url = `https://admob.googleapis.com/v1/accounts/${publisherId}/networkReport:generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reportSpec }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `AdMob API error ${res.status}`);
  }

  // Response is a JSON array: [{header}, {row}, ..., {footer}]
  return res.json();
}

function microsToDollars(micros) {
  return parseFloat((parseInt(micros || 0) / 1_000_000).toFixed(4));
}

function intVal(v) {
  return parseInt(v || 0);
}

// GET /api/admin/analytics/mobile
router.get("/", isAdminAuthorized, async (_req, res) => {
  try {
    const publisherId = process.env.ADMOB_PUBLISHER_ID;
    if (!publisherId) {
      return res.status(503).json({ success: false, error: "ADMOB_PUBLISHER_ID not configured" });
    }

    const token = await getAccessToken();
    const startDate = dateObj(29); // 30 days inclusive
    const endDate   = dateObj(0);

    const [dailyReport, platformReport] = await Promise.all([
      generateReport(publisherId, token, {
        dateRange: { startDate, endDate },
        dimensions: ["DATE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "AD_REQUESTS", "MATCHED_REQUESTS"],
        sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
        maxReportRows: 31,
      }),
      generateReport(publisherId, token, {
        dateRange: { startDate, endDate },
        dimensions: ["PLATFORM"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "AD_REQUESTS", "MATCHED_REQUESTS"],
      }),
    ]);

    // Both responses are arrays — extract only rows (skip header/footer)
    const dailyRows    = dailyReport.filter((r) => r.row).map((r) => r.row);
    const platformRows = platformReport.filter((r) => r.row).map((r) => r.row);

    const daily = dailyRows.map((row) => {
      const raw = row.dimensionValues?.DATE?.value || "";
      return {
        date:        `${raw.slice(4, 6)}/${raw.slice(6, 8)}`,
        earnings:    microsToDollars(row.metricValues?.ESTIMATED_EARNINGS?.microsValue),
        impressions: intVal(row.metricValues?.IMPRESSIONS?.integerValue),
        clicks:      intVal(row.metricValues?.CLICKS?.integerValue),
      };
    });

    const platforms = platformRows.map((row) => {
      const name         = row.dimensionValues?.PLATFORM?.value || "UNKNOWN";
      const earnings     = microsToDollars(row.metricValues?.ESTIMATED_EARNINGS?.microsValue);
      const impressions  = intVal(row.metricValues?.IMPRESSIONS?.integerValue);
      const clicks       = intVal(row.metricValues?.CLICKS?.integerValue);
      const adRequests   = intVal(row.metricValues?.AD_REQUESTS?.integerValue);
      const matched      = intVal(row.metricValues?.MATCHED_REQUESTS?.integerValue);
      return {
        platform:    name === "ANDROID" ? "Android" : name === "IOS" ? "iOS" : name,
        earnings:    parseFloat(earnings.toFixed(2)),
        impressions,
        clicks,
        eCPM:        impressions > 0 ? parseFloat((earnings / impressions * 1000).toFixed(2)) : 0,
        fillRate:    adRequests  > 0 ? parseFloat((matched / adRequests * 100).toFixed(1))    : 0,
      };
    });

    const totalEarnings   = daily.reduce((s, r) => s + r.earnings, 0);
    const totalImpressions = daily.reduce((s, r) => s + r.impressions, 0);
    const totalClicks     = daily.reduce((s, r) => s + r.clicks, 0);

    return res.json({
      success: true,
      data: {
        summary: {
          earnings:    parseFloat(totalEarnings.toFixed(2)),
          impressions: totalImpressions,
          clicks:      totalClicks,
          eCPM:        totalImpressions > 0 ? parseFloat((totalEarnings / totalImpressions * 1000).toFixed(2)) : 0,
          ctr:         totalImpressions > 0 ? parseFloat((totalClicks / totalImpressions * 100).toFixed(2))    : 0,
        },
        daily,
        platforms,
      },
    });
  } catch (err) {
    console.error("AdMob analytics error:", err.message);
    return res.status(500).json({ success: false, error: err.message || "Failed to fetch AdMob data." });
  }
});

export default router;
