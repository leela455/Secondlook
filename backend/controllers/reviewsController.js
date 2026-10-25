'use strict';
const Review = require('../models/Review');
const Attempt = require('../models/Attempt');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const { ok, pageMeta } = require('../utils/respond');
const workflow = require('../services/workflowService');

const INSPECTION_FIELDS = 'code componentName inspectionType status latest attemptCount reviewOpen lastDecision inspector deletedAt';

async function list(req, res) {
  const { status, type, page, limit } = req.valid.query;
  const filter = {};
  if (status !== 'all') filter.status = status;
  else filter.status = { $in: ['open', 'decided'] };
  if (type) filter.type = type;
  const [items, total] = await Promise.all([
    Review.find(filter)
      .sort(status === 'open' ? { createdAt: 1 } : { 'decision.decidedAt': -1, createdAt: -1 }) // oldest open review first
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'inspection', select: INSPECTION_FIELDS, populate: { path: 'inspector', select: 'name' } })
      .populate('requestedBy', 'name')
      .populate('decision.reviewer', 'name'),
    Review.countDocuments(filter),
  ]);
  ok(res, items, { meta: pageMeta(page, limit, total) });
}

async function get(req, res) {
  const review = await Review.findById(req.valid.params.id)
    .populate({ path: 'inspection', select: INSPECTION_FIELDS, populate: { path: 'inspector', select: 'name' } })
    .populate('requestedBy', 'name')
    .populate('decision.reviewer', 'name')
    .populate('history.by', 'name');
  if (!review || !review.inspection || review.inspection.deletedAt) throw AppError.notFound('Review not found');
  const [attempts, audit] = await Promise.all([
    Attempt.find({ inspection: review.inspection._id }).sort({ number: 1 }),
    AuditLog.find({ inspection: review.inspection._id }).sort({ createdAt: 1, _id: 1 }),
  ]);
  ok(res, { review, attempts, audit });
}

async function decide(req, res) {
  const review = await Review.findById(req.valid.params.id);
  if (!review) throw AppError.notFound('Review not found');
  const { decision, verdict, comment } = req.body;
  const r = await workflow.decideReview({ review, user: req.user, decision, verdict, comment });
  ok(res, r);
}

module.exports = { list, get, decide };
