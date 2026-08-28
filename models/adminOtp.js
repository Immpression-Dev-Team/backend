import mongoose from 'mongoose';

// Kept as its own collection (separate from the end-user OTP model in
// otp.js) so admin sign-in codes never share storage with the lower-trust
// signup/password-reset OTP flow.
const adminOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  codeHash: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // 10 minutes
  },
});

const AdminOTP = mongoose.model('AdminOTP', adminOtpSchema);

export default AdminOTP;
