// models/users.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    email: {
      type: String,
      unique: true,
      required: [true, 'Email is required'],
      match: [/^\w+(\.\w+)*@\w+([\-]?\w+)*(\.\w{2,3})+$/, 'Invalid email address'],
    },
    name: {
      type: String,
      required: false,
      minLength: [4, 'Name should be at least 4 characters'],
      maxLength: [30, 'Name should be less than 30 characters'],
    },
    password: {
      type: String,
      required: false,
      select: false,
      minLength: [8, 'Password should be at least 8 characters'],
    },
    passwordChangedAt: { type: Date, default: null },

    profilePictureLink: {
      type: String,
      default:
        'https://res.cloudinary.com/dttomxwev/image/upload/v1731113780/quisplf7viuudtptaund',
    },

    bio: { type: String, maxLength: [500, 'Bio should be less than 500 characters'], default: null },

    artistType: { type: String, maxLength: [50, 'Artist type should be less than 50 characters'], default: null },

    views: { type: Number, default: 0 },

    accountType: {
      type: String,
      enum: {
        values: ['artist', 'art-lover'],
        message: '{VALUE} is not a valid account type. Choose either "artist" or "art-lover".',
      },
      default: null,
    },

    artCategories: { type: [String], default: [] },

    // ✅ NEW
    zipcode: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator: (v) => v == null || /^\d{5}(-\d{4})?$/.test(v),
        message: 'Zip code must be 5 digits or ZIP+4 (e.g., 94107 or 94107-1234).',
      },
    },

    isGoogleUser: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },

    stripeAccountId: { type: String, default: null },
    stripeOnboardingCompleted: { type: Boolean, default: false },
    stripeOnboardingCompletedAt: { type: Date, default: null },

    likedImages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Image' }],

    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true, versionKey: '__v' }
);

UserSchema.methods.incrementViews = async function () {
  this.views = this.views + 1;
  await this.save();
};

const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

export default UserModel;
