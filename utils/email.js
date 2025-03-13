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

export const generatePasswordResetEmailTemplate = (
  otp,
  name
) => `<!DOCTYPE html>
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
          <p>If you need assistance, please <a href="mailto:support@immpression.com">contact us</a>.</p>
          <p>&copy; ${new Date().getFullYear()} Immpression. All rights reserved.</p>
        </div>
      </div>
    </body>
  </html>
  `;
