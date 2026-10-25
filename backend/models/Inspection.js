'use strict';
const mongoose = require('mongoose');
const { STATUS, STATUS_LIST, INSPECTION_TYPES, VISA_MODEL_CATEGORIES } = require('../utils/constants');

const qualitySchema = new mongoose.Schema(
  {
    sharpness: { type: Number, min: 0, max: 100, default: null },
    lighting: { type: Number, min: 0, max: 100, default: null },
    alignment: { type: Number, min: 0, max: 100, default: null },
    visibility: { type: Number, min: 0, max: 100, default: null },
  },
  { _id: false }
);

// Denormalised snapshot of the newest attempt: lets the queue sort/filter without joins.
const latestSchema = new mongoose.Schema(
  {
    attemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attempt' },
    attemptNumber: Number,
    confidence: { type: Number, min: 0, max: 100, default: null },
    anomaly: {
      score: { type: Number, min: 0, default: null },
      threshold: { type: Number, min: 0, default: null },
      decision: { type: String, enum: ['normal', 'anomalous', 'uncertain', null], default: null },
    },
    quality: { type: qualitySchema, default: () => ({}) },
    evidenceLabel: { type: String, enum: ['Adequate', 'Marginal', 'Insufficient', 'Unavailable'], default: 'Unavailable' },
    assessmentStatus: { type: String, enum: ['assessed', 'failed'], default: 'assessed' },
    sourceKind: { type: String, enum: ['demo', 'model', 'manual', 'seed'] },
    evaluated: { type: Boolean, default: false },
    hasImage: { type: Boolean, default: false },
  },
  { _id: false }
);

const inspectionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // e.g. SL-1042
    componentName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    inspectionType: { type: String, enum: INSPECTION_TYPES, default: INSPECTION_TYPES[0] },
    modelCategory: { type: String, enum: [...VISA_MODEL_CATEGORIES, null], default: null },
    status: { type: String, enum: STATUS_LIST, required: true, default: STATUS.REINSPECT },
    inspector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedReviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    defectDetails: {
      category: { type: String, trim: true, maxlength: 80, default: '' },
      severity: { type: String, enum: ['', 'minor', 'major', 'critical'], default: '' },
      description: { type: String, trim: true, maxlength: 1000, default: '' },
    },
    attemptCount: { type: Number, default: 0 },
    latest: { type: latestSchema, default: () => ({}) },
    // Newest decision with the rule and reason that produced it.
    lastDecision: {
      rule: String,
      reason: String,
      recommendations: [String],
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      automated: Boolean,
      at: Date,
    },
    reviewOpen: { type: Boolean, default: false },
    humanVerified: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
      verdict: { type: String, enum: ['pass', 'defect'] },
    },
    deletedAt: { type: Date, default: null }, // soft delete: evidence + audit trail are preserved
  },
  { timestamps: true }
);

inspectionSchema.index({ status: 1, createdAt: -1 });
inspectionSchema.index({ inspector: 1, createdAt: -1 });
inspectionSchema.index({ deletedAt: 1, createdAt: -1 });

inspectionSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Inspection', inspectionSchema);
