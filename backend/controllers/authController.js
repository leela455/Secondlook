'use strict';
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { env } = require('../config/env');
const { signToken } = require('../middleware/auth');
const AppError = require('../utils/AppError');
const { ok } = require('../utils/respond');
const { ROLES } = require('../utils/constants');

// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5D1Z5W6l3O0W6yq3x0xZ1p3rZk8v1dK';

async function register(req, res) {
  if (!env.allowRegistration) throw AppError.forbidden('Registration is disabled on this server.');
  const { name, email, password } = req.body;
  // The very first account becomes the administrator; everyone after is an inspector.
  // Role can never be chosen at sign-up. Admins promote users via PATCH /users/:id.
  const role = (await User.estimatedDocumentCount()) === 0 ? ROLES.ADMIN : ROLES.INSPECTOR;
  let user;
  try {
    user = await User.create({ name, email, password: await User.hashPassword(password), role });
  } catch (e) {
    if (e.code === 11000) throw new AppError(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
    throw e;
  }
  user.tokenVersion = 0;
  ok(res, { token: signToken(user), user }, { status: 201 });
}

async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password +tokenVersion');
  const valid = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !valid) throw new AppError(401, 'Incorrect email or password.', 'INVALID_CREDENTIALS');
  if (!user.active) throw new AppError(403, 'This account has been disabled. Contact an administrator.', 'ACCOUNT_DISABLED');
  user.lastLoginAt = new Date();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });
  ok(res, { token: signToken(user), user });
}

// JWTs are stateless, so "logout" bumps tokenVersion: every token issued before now stops working.
async function logout(req, res) {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  ok(res, { message: 'Signed out.' });
}

const me = (req, res) => ok(res, { user: req.user });

module.exports = { register, login, logout, me };
