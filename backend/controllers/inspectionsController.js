'use strict';
const path = require('path');
const Inspection = require('../models/Inspection');
const Attempt = require('../models/Attempt');
const Review = require('../models/Review');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const { ok, pageMeta } = require('../utils/respond');
const { escapeRegex } = require('../utils/helpers');
const { ROLES } = require('../utils/constants');
const { scopeFilter, findInspection, assertCanModify, canModify } = require('../services/scope');
const workflow = require('../services/workflowService');
const { logAudit } = require('../services/auditService');

const populate = (q) => q.populate('inspector', 'name email role').populate('assignedReviewer', 'name email');

const outcomeView = (o) => ({ status: o.status, rule: o.rule, reason: o.reason, recommendations: o.recommendations, evidence: o.evidence });

function searchFilter(q) {
  const rx = { $regex: escapeRegex(q), $options: 'i' }; // user text is escaped: it can never become a regex or operator
  return { $or: [{ code: rx }, { componentName: rx }] };
}

async function create(req, res) {
  const { inspection, attempt, outcome } = await workflow.createInspection({ user: req.user, fields: req.body, file: req.file });
  ok(res, { inspection, attempt, outcome: outcomeView(outcome) }, { status: 201 });
}

async function list(req, res) {
  const { q, status, page, limit, sort, order, from, to } = req.valid.query;
  const filter = { ...scopeFilter(req.user) };
  if (status) filter.status = status;
  if (q) Object.assign(filter, searchFilter(q));
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(new Date(to).getTime() + 86400000 - 1) : new Date(to);
  }
  const sortField = sort === 'confidence' ? 'latest.confidence' : sort;
  const dir = order === 'asc' ? 1 : -1;
  const [items, total] = await Promise.all([
    populate(Inspection.find(filter).sort({ [sortField]: dir, _id: -1 }).skip((page - 1) * limit).limit(limit)),
    Inspection.countDocuments(filter),
  ]);
  ok(res, items, { meta: pageMeta(page, limit, total) });
}

async function get(req, res) {
  const found = await findInspection(req.valid.params.id, req.user);
  const inspection = await populate(Inspection.findById(found._id));
  const [attempts, audit, reviews] = await Promise.all([
    Attempt.find({ inspection: found._id }).sort({ number: 1 }),
    AuditLog.find({ inspection: found._id }).sort({ createdAt: 1, _id: 1 }),
    Review.find({ inspection: found._id }).populate('decision.reviewer', 'name').populate('requestedBy', 'name').sort({ createdAt: -1 }),
  ]);
  ok(res, { inspection, attempts, audit, reviews, permissions: { canModify: canModify(req.user, inspection) } });
}

async function update(req, res) {
  const inspection = await findInspection(req.valid.params.id, req.user);
  const { componentName, notes, defectDetails, assignedReviewer } = req.body;
  const changed = [];

  if (componentName !== undefined || notes !== undefined || defectDetails !== undefined) {
    assertCanModify(req.user, inspection);
    if (componentName !== undefined) inspection.componentName = componentName;
    if (notes !== undefined) inspection.notes = notes;
    if (defectDetails) Object.entries(defectDetails).forEach(([k, v]) => v !== undefined && (inspection.defectDetails[k] = v));
    changed.push(...['componentName', 'notes', 'defectDetails'].filter((k) => req.body[k] !== undefined));
  }
  if (assignedReviewer !== undefined) {
    if (req.user.role !== ROLES.ADMIN) throw AppError.forbidden('Only an administrator can assign a reviewer.');
    if (assignedReviewer) {
      const r = await User.findOne({ _id: assignedReviewer, active: true, role: { $in: [ROLES.REVIEWER, ROLES.ADMIN] } });
      if (!r) throw AppError.badRequest('Assigned reviewer must be an active reviewer or administrator.');
    }
    inspection.assignedReviewer = assignedReviewer;
    changed.push('assignedReviewer');
  }
  await inspection.save();
  await logAudit({ inspection, actor: req.user, action: 'inspection_updated', meta: { fields: changed } });
  ok(res, await populate(Inspection.findById(inspection._id)));
}

// Soft delete: the record, its evidence files and its audit trail are kept for traceability.
async function remove(req, res) {
  const inspection = await findInspection(req.valid.params.id, req.user);
  inspection.deletedAt = new Date();
  inspection.reviewOpen = false;
  await inspection.save();
  await Review.updateMany({ inspection: inspection._id, status: 'open' }, { $set: { status: 'cancelled' } });
  await logAudit({ inspection, actor: req.user, action: 'inspection_deleted', reason: 'Soft-deleted by administrator' });
  ok(res, { message: `${inspection.code} was deleted.` });
}

async function evidenceForInspection(req, res) {
  const inspection = await findInspection(req.valid.params.id, req.user);
  ok(res, await Attempt.find({ inspection: inspection._id }).sort({ number: 1 }));
}

async function evidenceImage(req, res, next) {
  const { id, attempt: number } = req.valid.params;
  const inspection = await findInspection(id, req.user);
  const attempt = await Attempt.findOne({ inspection: inspection._id, number });
  if (!attempt) throw AppError.notFound('Attempt not found');
  if (!attempt.image || !attempt.image.storedName) throw AppError.notFound('No image was uploaded for this attempt (sample data).');
  const stored = path.basename(attempt.image.storedName); // defence in depth: never allow path traversal
  res.sendFile(
    path.join(env.uploadDir, stored),
    { headers: { 'Content-Type': attempt.image.mimeType, 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline' } },
    (err) => {
      if (err && !res.headersSent) next(AppError.notFound('The image file is missing from storage.'));
    }
  );
}

async function recapture(req, res) {
  const inspection = await findInspection(req.valid.params.id, req.user);
  assertCanModify(req.user, inspection);
  const { inspection: updated, attempt } = await workflow.addRecapture({ inspection, user: req.user, file: req.file });
  ok(res, { inspection: updated, attempt }, { status: 201 });
}

async function decide(req, res) {
  const inspection = await findInspection(req.valid.params.id, req.user);
  assertCanModify(req.user, inspection);
  if (req.body.action === 'second_look') {
    const r = await workflow.runSecondLook({ inspection, user: req.user });
    return ok(res, { inspection: r.inspection, attempt: r.attempt, outcome: outcomeView(r.outcome) });
  }
  const updated = await workflow.escalate({ inspection, user: req.user, reason: req.body.reason, note: req.body.note });
  ok(res, { inspection: updated });
}

async function decisionHistory(req, res) {
  const inspection = await findInspection(req.valid.params.id, req.user);
  const entries = await AuditLog.find({
    inspection: inspection._id,
    action: { $in: ['decision', 'second_look', 'escalated', 'review_decision', 'review_escalated'] },
  }).sort({ createdAt: 1, _id: 1 });
  ok(res, entries);
}

// Evidence history across all inspections the caller may see (one row per attempt).
async function evidenceHistory(req, res) {
  const { q, status, page, limit } = req.valid.query;
  const insFilter = { ...scopeFilter(req.user) };
  if (status) insFilter.status = status;
  if (q) Object.assign(insFilter, searchFilter(q));
  const ids = await Inspection.find(insFilter).distinct('_id');
  const filter = { inspection: { $in: ids } };
  const [items, total] = await Promise.all([
    Attempt.find(filter).sort({ createdAt: -1, number: -1 }).skip((page - 1) * limit).limit(limit).populate('inspection', 'code componentName status inspectionType'),
    Attempt.countDocuments(filter),
  ]);
  ok(res, items, { meta: pageMeta(page, limit, total) });
}

module.exports = { create, list, get, update, remove, evidenceForInspection, evidenceImage, recapture, decide, decisionHistory, evidenceHistory };
