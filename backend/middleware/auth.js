'use strict';
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { asyncHandler } = require('../utils/helpers');

const signToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion || 0 }, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwtExpiresIn,
  });

// Verifies the Bearer token AND re-loads the user, so role changes, deactivation and logout take effect immediately.
const authenticate = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw AppError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    throw new AppError(
      401,
      e.name === 'TokenExpiredError' ? 'Your session has expired. Please sign in again.' : 'Invalid authentication token',
      'SESSION_EXPIRED'
    );
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.active || (user.tokenVersion || 0) !== payload.tv) {
    throw new AppError(401, 'Your session is no longer valid. Please sign in again.', 'SESSION_EXPIRED');
  }
  req.user = user;
  next();
});

const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden(`This action requires one of: ${roles.join(', ')}`));
    next();
  };

module.exports = { signToken, authenticate, authorize };
