'use strict';
const mongoose = require('mongoose');

const DEFAULTS = Object.freeze({
  confidenceThreshold: 80, // below this the model's verdict is "uncertain" -> human review
  minQualityScore: 60, // any quality metric below this = evidence insufficient -> reinspection
  adequateQualityScore: 80, // average quality needed for "Adequate" (a pass needs Adequate evidence)
  maxAttempts: 3, // after this many insufficient attempts the case goes to a human
  requireDefectSignoff: true, // confirmed defects always need a human sign-off
});

// Singleton document holding the application-wide inspection rules.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'app', unique: true },
    confidenceThreshold: { type: Number, min: 50, max: 99, default: DEFAULTS.confidenceThreshold },
    minQualityScore: { type: Number, min: 20, max: 95, default: DEFAULTS.minQualityScore },
    adequateQualityScore: { type: Number, min: 30, max: 99, default: DEFAULTS.adequateQualityScore },
    maxAttempts: { type: Number, min: 1, max: 10, default: DEFAULTS.maxAttempts },
    requireDefectSignoff: { type: Boolean, default: DEFAULTS.requireDefectSignoff },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

settingSchema.set('toJSON', {
  transform(_d, ret) {
    delete ret._id;
    delete ret.__v;
    delete ret.key;
    return ret;
  },
});

module.exports = { Setting: mongoose.model('Setting', settingSchema), DEFAULTS };
