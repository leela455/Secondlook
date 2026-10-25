'use strict';
const { Setting, DEFAULTS } = require('../models/Setting');
const AppError = require('../utils/AppError');

async function getSettings() {
  let doc = await Setting.findOne({ key: 'app' });
  if (!doc) {
    try {
      doc = await Setting.create({ key: 'app', ...DEFAULTS });
    } catch (e) {
      if (e.code !== 11000) throw e; // another request created it first
      doc = await Setting.findOne({ key: 'app' });
    }
  }
  return doc;
}

async function updateSettings(patch, user) {
  const doc = await getSettings();
  const next = { ...doc.toObject(), ...patch };
  if (next.minQualityScore >= next.adequateQualityScore) {
    throw AppError.badRequest('minQualityScore must be lower than adequateQualityScore', [
      { field: 'minQualityScore', message: 'Must be lower than adequateQualityScore' },
    ]);
  }
  Object.assign(doc, patch, { updatedBy: user._id });
  await doc.save();
  return doc;
}

module.exports = { getSettings, updateSettings };
