'use strict';
const mongoose = require('mongoose');
const { STATUS_LIST, VISA_MODEL_CATEGORIES } = require('../utils/constants');

const score = { type: Number, min: 0, max: 100, default: null }; // null = NOT calculated (never faked as 0)

// One evidence image + its assessment. Attempts are append-only: a recapture never overwrites earlier ones.
const attemptSchema = new mongoose.Schema(
  {
    inspection: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection', required: true },
    number: { type: Number, required: true, min: 1 },
    image: {
      // Seed/sample attempts have no file; real uploads always do.
      storedName: String,
      originalName: { type: String, maxlength: 255 },
      mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'] },
      size: Number,
      sha256: String,
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    modelCategory: { type: String, enum: [...VISA_MODEL_CATEGORIES, null], default: null },
    assessmentStatus: { type: String, enum: ['assessed', 'failed'], required: true },
    assessmentError: { type: String, maxlength: 500 },
    quality: {
      sharpness: score,
      lighting: score,
      alignment: score,
      visibility: score,
    },
    qualityMeasurements: { type: mongoose.Schema.Types.Mixed, default: null },
    anomaly: {
      score: { type: Number, min: 0, default: null },
      threshold: { type: Number, min: 0, default: null },
      decision: { type: String, enum: ['normal', 'anomalous', 'uncertain', null], default: null },
      scoreSemantics: { type: String, maxlength: 180 },
      localization: { x: Number, y: Number, w: Number, h: Number },
      validation: {
        category: { type: String, enum: [...VISA_MODEL_CATEGORIES, null], default: null },
        status: { type: String, enum: ['validated', null], default: null },
        dataset: String,
        evaluatedAt: String,
      },
    },
    defect: {
      detected: { type: Boolean, default: null },
      label: { type: String, maxlength: 80 },
      confidence: score, // model confidence in its own prediction; separate from image quality
      bbox: { x: Number, y: Number, w: Number, h: Number }, // fractions 0..1, only when the provider reports one
    },
    evidence: {
      label: { type: String, enum: ['Adequate', 'Marginal', 'Insufficient', 'Unavailable'], default: 'Unavailable' },
      weakMetrics: [String],
    },
    source: {
      kind: { type: String, enum: ['demo', 'model', 'manual', 'seed'], required: true },
      provider: String,
      modelVersion: String,
      demo: { type: Boolean, default: false },
    },
    // Outcome of evaluating this attempt. evaluated=false means "uploaded, waiting for Run Second Look".
    evaluated: { type: Boolean, default: false },
    outcome: { type: String, enum: [...STATUS_LIST, null], default: null },
    outcomeRule: String,
    evaluatedAt: Date,
    thresholds: { confidenceThreshold: Number, minQualityScore: Number }, // thresholds in force when evaluated
  },
  { timestamps: true }
);

attemptSchema.index({ inspection: 1, number: 1 }, { unique: true });
attemptSchema.index({ createdAt: -1 });

attemptSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    if (ret.image) {
      ret.hasImage = !!ret.image.storedName;
      delete ret.image.storedName; // internal storage reference is never exposed
    } else ret.hasImage = false;
    return ret;
  },
});

module.exports = mongoose.model('Attempt', attemptSchema);
