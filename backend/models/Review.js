'use strict';
const mongoose = require('mongoose');
const { REVIEW_TYPES, REVIEW_DECISIONS, STATUS_LIST } = require('../utils/constants');

const reviewSchema = new mongoose.Schema(
  {
    inspection: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection', required: true },
    attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'Attempt' },
    type: { type: String, enum: Object.values(REVIEW_TYPES), required: true },
    reason: { type: String, maxlength: 600, default: '' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null when raised automatically
    automated: { type: Boolean, default: false },
    level: { type: String, enum: ['reviewer', 'admin'], default: 'reviewer' },
    status: { type: String, enum: ['open', 'decided', 'cancelled'], default: 'open' }, // cancelled = inspection was deleted
    // Final decision (set once).
    decision: {
      action: { type: String, enum: REVIEW_DECISIONS },
      verdict: { type: String, enum: ['pass', 'defect'] },
      comment: { type: String, maxlength: 1000 },
      reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      decidedAt: Date,
      resultingStatus: { type: String, enum: STATUS_LIST },
    },
    // Every reviewer action, including escalations that keep the review open.
    history: [
      {
        _id: false,
        action: { type: String, enum: REVIEW_DECISIONS },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        comment: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// At most one OPEN review per inspection.
reviewSchema.index({ inspection: 1 }, { name: 'one_open_review_per_inspection', unique: true, partialFilterExpression: { status: 'open' } });
reviewSchema.index({ status: 1, createdAt: -1 });
reviewSchema.index({ 'decision.reviewer': 1, 'decision.decidedAt': -1 });

reviewSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Review', reviewSchema);
