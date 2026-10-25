'use strict';
const mongoose = require('mongoose');
const Inspection = require('../models/Inspection');
const AppError = require('../utils/AppError');
const { ROLES } = require('../utils/constants');

// Inspectors only see their own inspections; reviewers and admins see everything.
const scopeFilter = (user) => (user.role === ROLES.INSPECTOR ? { deletedAt: null, inspector: user._id } : { deletedAt: null });

const canModify = (user, inspection) =>
  user.role === ROLES.ADMIN || (user.role === ROLES.INSPECTOR && String(inspection.inspector._id || inspection.inspector) === String(user._id));

/** Find by "SL-1042" or a Mongo id. Out-of-scope records look exactly like missing ones (404). */
async function findInspection(idOrCode, user) {
  const key = String(idOrCode);
  const idFilter = /^[a-f\d]{24}$/i.test(key) && mongoose.isValidObjectId(key) ? { _id: key } : { code: key.toUpperCase() };
  const doc = await Inspection.findOne({ ...idFilter, ...scopeFilter(user) });
  if (!doc) throw AppError.notFound('Inspection not found');
  return doc;
}

function assertCanModify(user, inspection) {
  if (!canModify(user, inspection)) throw AppError.forbidden('Only the inspector who owns this inspection (or an administrator) can do that');
}

module.exports = { scopeFilter, canModify, findInspection, assertCanModify };
