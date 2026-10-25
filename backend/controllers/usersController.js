'use strict';
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { ok, pageMeta } = require('../utils/respond');

async function list(req, res) {
  const { page, limit, role } = req.valid.query;
  const filter = role ? { role } : {};
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  ok(res, items, { meta: pageMeta(page, limit, total) });
}

async function update(req, res) {
  const { id } = req.valid.params;
  if (String(req.user._id) === id) throw AppError.badRequest('You cannot change your own role or disable your own account.');
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('User not found');
  if (req.body.role !== undefined) user.role = req.body.role;
  if (req.body.active !== undefined) user.active = req.body.active;
  // Force the affected user to sign in again so the change applies immediately.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  ok(res, user);
}

module.exports = { list, update };
