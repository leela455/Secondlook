'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { env } = require('../config/env');
const { ROLES } = require('../utils/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    // select:false -> never returned unless explicitly requested (login only).
    password: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.INSPECTOR, index: true },
    active: { type: Boolean, default: true },
    // Incremented on logout / password change; tokens carrying an older value are rejected.
    tokenVersion: { type: Number, default: 0, select: false },
    preferences: {
      theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
    },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);
userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.__v;
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
