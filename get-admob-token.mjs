/**
 * get-admob-token.mjs
 *
 * Generates a new ADMOB_REFRESH_TOKEN via Google OAuth2.
 *
 * Prerequisites:
 *   1. ADMOB_CLIENT_ID and ADMOB_CLIENT_SECRET must be set in your environment
 *      (or in a .env file if you have dotenv). These come from the Google Cloud
 *      Console OAuth 2.0 client you use for AdMob.
 *   2. http://localhost:8080 must be added as an authorized redirect URI for
 *      that OAuth client in Google Cloud Console → APIs & Services → Credentials.
 *
 * Run:
 *   node get-admob-token.mjs
 *
 * It will open your browser, ask you to authorize, then print the refresh token.
 */

import http from "http";
import { exec } from "child_process";
import { URL } from "url";
import readline from "readline";

// ── Load env vars ────────────────────────────────────────────────────────────
// Try dotenv if available, otherwise rely on shell env.
try {
  const { config } = await import("dotenv");
  config();
} catch {
  // dotenv not installed — that's fine, use process.env directly
}

const CLIENT_ID     = process.env.ADMOB_CLIENT_ID;
const CLIENT_SECRET = process.env.ADMOB_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:8080";
const SCOPE         = "https://www.googleapis.com/auth/admob.report";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\n❌  ADMOB_CLIENT_ID and ADMOB_CLIENT_SECRET must be set in your environment.\n" +
    "    Export them in your terminal before running this script:\n\n" +
    "      set ADMOB_CLIENT_ID=your-client-id\n" +
    "      set ADMOB_CLIENT_SECRET=your-client-secret\n"
  );
  process.exit(1);
}

// ── Build authorization URL ──────────────────────────────────────────────────
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id",     CLIENT_ID);
authUrl.searchParams.set("redirect_uri",  REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope",         SCOPE);
authUrl.searchParams.set("access_type",   "offline");
authUrl.searchParams.set("prompt",        "consent"); // forces new refresh token

console.log("\n📋  Opening Google authorization page in your browser…");
console.log("    If it doesn't open automatically, paste this URL:\n");
console.log("   ", authUrl.toString(), "\n");

// Open browser (Windows)
exec(`start "" "${authUrl.toString()}"`);

// ── Start local server to catch the redirect ─────────────────────────────────
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, REDIRECT_URI);
  const code   = reqUrl.searchParams.get("code");
  const error  = reqUrl.searchParams.get("error");

  res.writeHead(200, { "Content-Type": "text/html" });

  if (error) {
    res.end(`<h2>❌ Authorization denied: ${error}</h2><p>You can close this tab.</p>`);
    console.error("\n❌  Authorization denied:", error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end("<h2>No code received — try again.</h2>");
    return;
  }

  res.end("<h2>✅ Authorization successful — you can close this tab.</h2><p>Check your terminal for the refresh token.</p>");
  server.close();

  // ── Exchange code for tokens ───────────────────────────────────────────────
  console.log("\n🔄  Exchanging authorization code for tokens…\n");
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    "authorization_code",
      }),
    });

    const data = await tokenRes.json();

    if (!data.refresh_token) {
      console.error("❌  No refresh token in response:", JSON.stringify(data, null, 2));
      console.log('\n💡  Tip: If you see "already has a token", go to');
      console.log("    https://myaccount.google.com/permissions and revoke");
      console.log('    the app access, then run this script again.\n');
      process.exit(1);
    }

    console.log("━".repeat(60));
    console.log("✅  SUCCESS — copy this value into your Vercel environment:\n");
    console.log("   ADMOB_REFRESH_TOKEN =", data.refresh_token);
    console.log("\n" + "━".repeat(60));
    console.log("\n📌  Steps:");
    console.log("   1. Go to vercel.com → your backend project → Settings → Environment Variables");
    console.log("   2. Find ADMOB_REFRESH_TOKEN and update its value");
    console.log("   3. Redeploy the backend\n");

  } catch (err) {
    console.error("❌  Token exchange failed:", err.message);
    process.exit(1);
  }
});

server.listen(8080, () => {
  console.log("⏳  Waiting for Google to redirect back (listening on port 8080)…\n");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("\n❌  Port 8080 is already in use. Close whatever is using it and try again.\n");
  } else {
    console.error("❌  Server error:", err.message);
  }
  process.exit(1);
});
