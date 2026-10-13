// routes/admin-userAuthRoutes/admin-analyticsRoutes.js
// Uses GA4 Data API via REST (not gRPC) — compatible with Vercel serverless.
// Required env vars:
//   GA4_PROPERTY_ID          — numeric GA4 property ID (e.g. "531614205")
//   GA4_SERVICE_ACCOUNT_JSON — full JSON string of service account key file

import express from "express";
import { GoogleAuth } from "google-auth-library";
import { isAdminAuthorized } from "../../utils/authUtils.js";

const router = express.Router();

async function getAccessToken() {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GA4_SERVICE_ACCOUNT_JSON not set");

  const credentials = JSON.parse(raw);

  // Vercel sometimes escapes \n as \\n in env vars — fix the private key
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// monthsAgo=0 -> 1st of this month through today; monthsAgo=1 -> the full
// previous calendar month (1st through last day), for a this-month vs
// last-month comparison instead of 30d vs 7d.
function monthRange(monthsAgo) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const end = monthsAgo === 0
    ? now
    : new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

async function runReport(propertyId, accessToken, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `GA4 API error ${res.status}`);
  }
  return res.json();
}

// GET /api/admin/analytics/web
router.get("/", isAdminAuthorized, async (_req, res) => {
  try {
    const propertyId = process.env.GA4_PROPERTY_ID;
    if (!propertyId) {
      return res.status(503).json({ success: false, error: "GA4_PROPERTY_ID not set" });
    }

    const token = await getAccessToken();
    const thisMonth = monthRange(0);
    const lastMonth = monthRange(1);

    const [summaryThisMonth, summaryLastMonth, monthlyRes, topPagesRes, sourcesRes] = await Promise.all([
      runReport(propertyId, token, {
        dateRanges: [thisMonth],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
        ],
      }),
      runReport(propertyId, token, {
        dateRanges: [lastMonth],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
      }),
      runReport(propertyId, token, {
        // ~12 months back, grouped by calendar month
        dateRanges: [{ startDate: "365daysAgo", endDate: "today" }],
        dimensions: [{ name: "yearMonth" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        orderBys: [{ dimension: { dimensionName: "yearMonth" } }],
      }),
      runReport(propertyId, token, {
        dateRanges: [thisMonth],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
      runReport(propertyId, token, {
        dateRanges: [thisMonth],
        dimensions: [{ name: "sessionDefaultChannelGrouping" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      }),
    ]);

    const mvThis = summaryThisMonth.rows?.[0]?.metricValues ?? [];
    const mvLast = summaryLastMonth.rows?.[0]?.metricValues ?? [];

    const monthly = (monthlyRes.rows ?? []).map((row) => {
      const raw = row.dimensionValues[0].value; // "202501"
      const mon = parseInt(raw.slice(4, 6), 10);
      const yr = raw.slice(2, 4);
      return {
        month: `${MONTH_NAMES[mon - 1]} '${yr}`,
        pageViews: parseInt(row.metricValues[0].value || 0),
        users: parseInt(row.metricValues[1].value || 0),
      };
    });

    const topPages = (topPagesRes.rows ?? []).map((row) => ({
      path: row.dimensionValues[0].value,
      title: row.dimensionValues[1].value,
      pageViews: parseInt(row.metricValues[0].value || 0),
      users: parseInt(row.metricValues[1].value || 0),
    }));

    const sources = (sourcesRes.rows ?? []).map((row) => ({
      channel: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value || 0),
      users: parseInt(row.metricValues[1].value || 0),
    }));

    const totalSessions = sources.reduce((s, r) => s + r.sessions, 0);
    const sourcesWithPct = sources.map((s) => ({
      ...s,
      pct: totalSessions ? Math.round((s.sessions / totalSessions) * 100) : 0,
    }));

    return res.json({
      success: true,
      data: {
        thisMonth: {
          users:              parseInt(mvThis[0]?.value || 0),
          sessions:           parseInt(mvThis[1]?.value || 0),
          pageViews:          parseInt(mvThis[2]?.value || 0),
          bounceRate:         parseFloat(parseFloat(mvThis[3]?.value || 0).toFixed(1)),
          avgSessionDuration: Math.round(parseFloat(mvThis[4]?.value || 0)),
        },
        lastMonth: {
          users:     parseInt(mvLast[0]?.value || 0),
          sessions:  parseInt(mvLast[1]?.value || 0),
          pageViews: parseInt(mvLast[2]?.value || 0),
        },
        monthly,
        topPages,
        sources: sourcesWithPct,
      },
    });
  } catch (err) {
    console.error("GA4 analytics error:", err.message);
    return res.status(500).json({ success: false, error: err.message || "Failed to fetch analytics data." });
  }
});

export default router;
