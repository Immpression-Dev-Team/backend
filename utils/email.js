// utils/email.js

// --------------------
// OTP Email Template
// --------------------
export const generateOtpEmailTemplate = (otp, name) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OTP Verification</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f9f9f9;
      margin: 0;
      padding: 0;
    }
    .email-container {
      max-width: 600px;
      margin: 20px auto;
      background-color: #ffffff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .email-header {
      text-align: center;
      border-bottom: 1px solid #ddd;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .email-header h1 {
      font-size: 24px;
      color: #333;
      margin: 0;
    }
    .email-body {
      text-align: center;
      color: #555;
    }
    .otp {
      font-size: 32px;
      font-weight: bold;
      color: #1a73e8;
      margin: 20px 0;
    }
    .email-footer {
      text-align: center;
      font-size: 14px;
      color: #999;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>OTP Verification</h1>
    </div>
    <div class="email-body">
      <p>Hello ${name},</p>
      <p>Use the OTP below to complete your verification:</p>
      <div class="otp">${otp}</div>
      <p>This OTP is valid for the next 5 minutes. Do not share it with anyone.</p>
    </div>
    <div class="email-footer">
      <p>Welcome to Immpression!</p>
      <p>&copy; ${new Date().getFullYear()} Immpression. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

// --------------------
// Password Reset Email Template
// --------------------
export const generatePasswordResetEmailTemplate = (otp, name) => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset OTP</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f4f4f9;
        margin: 0;
        padding: 0;
      }
      .email-container {
        max-width: 600px;
        margin: 20px auto;
        background-color: #ffffff;
        border: 1px solid #dddddd;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
      }
      .header {
        background-color: #4CAF50;
        color: white;
        text-align: center;
        padding: 20px;
      }
      .header h1 {
        margin: 0;
        font-size: 24px;
      }
      .content {
        padding: 20px;
        color: #333333;
      }
      .content p {
        line-height: 1.6;
        margin: 10px 0;
      }
      .otp {
        font-size: 24px;
        font-weight: bold;
        text-align: center;
        background-color: #f9f9f9;
        padding: 10px;
        border: 1px dashed #4CAF50;
        margin: 20px 0;
        border-radius: 4px;
      }
      .footer {
        text-align: center;
        background-color: #f9f9f9;
        padding: 15px;
        font-size: 14px;
        color: #888888;
        border-top: 1px solid #dddddd;
      }
      .footer a {
        color: #4CAF50;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="header">
        <h1>Password Reset Request</h1>
      </div>
      <div class="content">
        <p>Hi, ${name}</p>
        <p>We received a request to reset your password. Use the OTP below to proceed with resetting your password. This OTP is valid for the next 5 minutes.</p>
        <div class="otp">${otp}</div>
        <p>If you did not request this, please ignore this email or contact our support team if you have any concerns.</p>
        <p>Thank you,<br>The Immpression Team</p>
      </div>
      <div class="footer">
        <p>If you need assistance, please <a href="mailto:immpression.nyc@gmail.com">contact us</a>.</p>
        <p>&copy; ${new Date().getFullYear()} Immpression. All rights reserved.</p>
      </div>
    </div>
  </body>
</html>
`;

// --------------------
// Order Notification Templates
// --------------------
const APP_BASE_URL = process.env.APP_BASE_URL || "https://immpression.art";
const orderUrl = (id) => `${APP_BASE_URL}/orders/${id}`;

const shell = (subject, body) => `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#111;">
  <div style="max-width:640px;margin:24px auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
    <div style="padding:14px 18px;border-bottom:1px solid #eee;font-weight:700">${subject}</div>
    <div style="padding:18px">${body}</div>
    <div style="padding:10px 18px;border-top:1px solid #eee;color:#6b7280;font-size:12px">
      If you didn’t expect this email, you can ignore it.
    </div>
  </div>
</div>`;

export const orderEmailTemplates = {
  buyerOrderConfirmed: ({ name, artName, price, orderId }) =>
    shell("Order confirmed", `
      <p>Hi ${name || "there"},</p>
      <p>Thanks for your purchase! We’re processing your order for <b>“${artName}”</b>.</p>
      <p>Total: <b>$${Number(price || 0).toFixed(2)}</b></p>
      <p><a href="${orderUrl(orderId)}" style="background:#635BFF;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block">View Order</a></p>
    `),

  sellerNewOrderPaid: ({ name, artName, price, orderId }) =>
    shell("New order to fulfill", `
      <p>Hi ${name || "there"},</p>
      <p>You’ve got a paid order for <b>“${artName}”</b>.</p>
      <p>Total: <b>$${Number(price || 0).toFixed(2)}</b></p>
      <p><a href="${orderUrl(orderId)}" style="background:#111827;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block">Fulfill Order</a></p>
    `),

  buyerShipped: ({ name, artName, carrier, tracking, orderId }) =>
    shell("Your order shipped", `
      <p>Hi ${name || "there"},</p>
      <p>Your order <b>“${artName}”</b> has shipped.</p>
      <p>${carrier ? `<b>${carrier}</b> ` : ""}${tracking ? `Tracking: <b>${tracking}</b>` : ""}</p>
      <p><a href="${orderUrl(orderId)}" style="background:#0ea5e9;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block">Track Package</a></p>
    `),

  buyerDelivered: ({ name, artName, orderId }) =>
    shell("Delivered", `
      <p>Hi ${name || "there"},</p>
      <p>Your order <b>“${artName}”</b> was delivered. Enjoy!</p>
      <p><a href="${orderUrl(orderId)}" style="background:#10b981;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block">View Order</a></p>
    `),
};
