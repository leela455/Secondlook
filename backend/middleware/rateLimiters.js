'use strict';
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

// Disabled during automated tests unless a test opts in with FORCE_RATE_LIMIT=1.
const skip = () => env.isTest && !process.env.FORCE_RATE_LIMIT;

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } }),
  });

// Brute-force protection on login/registration.
const authLimiter = make(15 * 60 * 1000, env.authRateLimitMax, 'Too many attempts. Please wait a few minutes and try again.');
// Generic ceiling for the whole API.
const apiLimiter = make(60 * 1000, env.apiRateLimitMax, 'Too many requests. Please slow down.');
// Uploads and model calls are the expensive/sensitive operations.
const writeLimiter = make(60 * 1000, 60, 'Too many uploads or decisions in a short time. Please slow down.');

module.exports = { authLimiter, apiLimiter, writeLimiter };
