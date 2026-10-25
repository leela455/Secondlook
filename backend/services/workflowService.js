'use strict';
// Business workflow for inspections. Controllers stay thin; every state change goes through here so that
// each transition is validated, recorded in the audit log, and never silently overwrites earlier results.
//
// MongoDB transactions need a replica set, which a default local install is not. Instead, multi-step changes use
// compare-and-set updates (so double clicks / races fail with 409) and compensating clean-up if a later step fails.
const mongoose = require('mongoose');
const Inspection = require('../models/Inspection');
const Attempt = require('../models/Attempt');
const Review = require('../models/Review');
const { nextInspectionCode } = require('../models/Counter');
const { STATUS, REVIEW_TYPES } = require('../utils/constants');
const AppError = require('../utils/AppError');
const { sha256File } = require('../utils/helpers');
const { assess } = require('./inspectionService');
const { decide, classifyEvidence } = require('./decisionService');
const { getSettings } = require('./settingsService');
const { logAudit } = require('./auditService');

const snapshot = (a, evaluated = a.evaluated) => ({
  attemptId: a._id,
  attemptNumber: a.number,
  confidence: a.defect ? a.defect.confidence ?? null : null,
  anomaly: a.anomaly && a.anomaly.score != null ? { score: a.anomaly.score, threshold: a.anomaly.threshold, decision: a.anomaly.decision } : undefined,
  quality: {
    sharpness: a.quality ? a.quality.sharpness ?? null : null,
    lighting: a.quality ? a.quality.lighting ?? null : null,
    alignment: a.quality ? a.quality.alignment ?? null : null,
    visibility: a.quality ? a.quality.visibility ?? null : null,
  },
  qualityMeasurements: a.qualityMeasurements || null,
  modelCategory: a.modelCategory || null,
  anomaly: a.anomaly || null,
  evidenceLabel: a.evidence.label,
  assessmentStatus: a.assessmentStatus,
  sourceKind: a.source.kind,
  evaluated,
  hasImage: !!(a.image && a.image.storedName),
});

async function assessFile(file, context) {
  const sha256 = await sha256File(file.path);
  const result = await assess({ filePath: file.path, mimeType: file.detectedMime, sha256, originalName: file.safeOriginalName, context });
  return { sha256, result };
}

function buildAttemptDoc({ id, inspectionId, number, user, file, sha256, result, modelCategory }) {
  return {
    _id: id,
    inspection: inspectionId,
    number,
    image: { storedName: file.filename, originalName: file.safeOriginalName, mimeType: file.detectedMime, size: file.size, sha256 },
    uploadedBy: user._id,
    assessmentStatus: result.assessmentStatus,
    assessmentError: result.assessmentError,
    quality: result.quality,
    qualityMeasurements: result.qualityMeasurements,
    modelCategory: result.modelCategory || modelCategory || null,
    anomaly: result.anomaly || undefined,
    defect: result.defect,
    source: result.source,
  };
}

const evaluationFields = (outcome, settings, now = new Date()) => ({
  evaluated: true,
  outcome: outcome.status,
  outcomeRule: outcome.rule,
  evaluatedAt: now,
  evidence: outcome.evidence,
  thresholds: { confidenceThreshold: settings.confidenceThreshold, minQualityScore: settings.minQualityScore },
});

async function openReview({ inspection, attempt, type, reason, user, automated }) {
  try {
    return await Review.create({
      inspection: inspection._id,
      attempt: attempt ? attempt._id : undefined,
      type,
      reason,
      requestedBy: user ? user._id : null,
      automated: !!automated,
      history: [],
    });
  } catch (e) {
    if (e.code === 11000) throw AppError.conflict('This inspection already has an open review.');
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
async function createInspection({ user, fields, file }) {
  const settings = await getSettings();
  const code = await nextInspectionCode();
  const attemptId = new mongoose.Types.ObjectId();
  const { sha256, result } = await assessFile(file, { componentName: fields.componentName, inspectionType: fields.inspectionType, modelCategory: fields.modelCategory });

  const attemptDoc = buildAttemptDoc({ id: attemptId, inspectionId: null, number: 1, user, file, sha256, result, modelCategory: fields.modelCategory });
  const outcome = decide({ number: 1, ...result }, settings);
  const now = new Date();

  const inspection = await Inspection.create({
    code,
    componentName: fields.componentName,
    inspectionType: fields.inspectionType,
    modelCategory: fields.modelCategory || null,
    notes: fields.notes,
    defectDetails: { category: fields.defectCategory, severity: fields.defectSeverity, description: fields.defectDescription },
    status: outcome.status,
    inspector: user._id,
    attemptCount: 1,
    reviewOpen: !!outcome.reviewType,
    lastDecision: { rule: outcome.rule, reason: outcome.reason, recommendations: outcome.recommendations, automated: true, at: now },
  });

  let attempt;
  try {
    attempt = await Attempt.create({ ...attemptDoc, inspection: inspection._id, ...evaluationFields(outcome, settings, now) });
    inspection.latest = snapshot(attempt);
    await inspection.save();
  } catch (e) {
    await Attempt.deleteOne({ _id: attemptId });
    await Inspection.deleteOne({ _id: inspection._id }); // compensate: no half-created inspection
    throw e;
  }

  await logAudit({ inspection, actor: user, action: 'inspection_created', to: outcome.status, meta: { code, inspectionType: fields.inspectionType } });
  await logAudit({ inspection, actor: user, action: 'evidence_uploaded', attemptNumber: 1, meta: { sha256, size: file.size, mimeType: file.detectedMime } });
  await logAudit({
    inspection,
    actor: null,
    action: result.assessmentStatus === 'assessed' ? 'assessment_completed' : 'assessment_failed',
    attemptNumber: 1,
    reason: result.assessmentError,
    meta: { source: result.source, confidence: result.defect.confidence, quality: result.quality },
  });
  await logAudit({ inspection, actor: null, action: 'decision', from: null, to: outcome.status, rule: outcome.rule, reason: outcome.reason, attemptNumber: 1 });

  if (outcome.reviewType) {
    await openReview({ inspection, attempt, type: outcome.reviewType, reason: outcome.reason, user: null, automated: true });
    await logAudit({ inspection, actor: null, action: 'review_opened', reason: outcome.reason, meta: { type: outcome.reviewType } });
  }
  return { inspection, attempt, outcome };
}

// ---------------------------------------------------------------------------------------------------------------
async function addRecapture({ inspection, user, file }) {
  if (inspection.status !== STATUS.REINSPECT) {
    throw AppError.conflict(`A recapture can only be uploaded while the status is "${STATUS.REINSPECT}" (current: "${inspection.status}").`);
  }
  if (!inspection.latest.evaluated) {
    throw AppError.conflict('The previous recapture has not been evaluated yet. Run Second Look first.');
  }
  // Claim the next attempt number atomically.
  const claimed = await Inspection.findOneAndUpdate(
    { _id: inspection._id, attemptCount: inspection.attemptCount, status: STATUS.REINSPECT, 'latest.evaluated': true, deletedAt: null },
    { $inc: { attemptCount: 1 } },
    { new: true }
  );
  if (!claimed) throw AppError.conflict('This inspection was just changed by someone else. Refresh and try again.');
  const number = claimed.attemptCount;

  try {
    const { sha256, result } = await assessFile(file, { componentName: claimed.componentName, inspectionType: claimed.inspectionType, modelCategory: claimed.modelCategory });
    const attempt = await Attempt.create({
      ...buildAttemptDoc({ id: new mongoose.Types.ObjectId(), inspectionId: claimed._id, number, user, file, sha256, result, modelCategory: claimed.modelCategory }),
      evaluated: false,
    });
    // Evidence quality label is informative now; the decision itself waits for "Run Second Look".
    const settings = await getSettings();
    const preview = decide({ number, ...result }, settings);
    attempt.evidence = preview.evidence;
    await attempt.save();
    claimed.latest = snapshot(attempt, false);
    await claimed.save();

    await logAudit({ inspection: claimed, actor: user, action: 'recapture_uploaded', attemptNumber: number, meta: { sha256, size: file.size, mimeType: file.detectedMime } });
    await logAudit({
      inspection: claimed,
      actor: null,
      action: result.assessmentStatus === 'assessed' ? 'assessment_completed' : 'assessment_failed',
      attemptNumber: number,
      reason: result.assessmentError,
      meta: { source: result.source, confidence: result.defect.confidence, quality: result.quality },
    });
    return { inspection: claimed, attempt };
  } catch (e) {
    await Inspection.updateOne({ _id: claimed._id, attemptCount: number }, { $inc: { attemptCount: -1 } }); // release the number
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
async function runSecondLook({ inspection, user }) {
  if (inspection.status !== STATUS.REINSPECT) {
    throw AppError.conflict(`Second Look can only run while the status is "${STATUS.REINSPECT}" (current: "${inspection.status}").`);
  }
  const attempt = await Attempt.findOne({ inspection: inspection._id, number: inspection.attemptCount });
  if (!attempt) throw AppError.notFound('Evidence for this inspection could not be found');
  if (attempt.evaluated) {
    throw AppError.conflict('The latest evidence has already been evaluated. Upload a recapture before running Second Look again.');
  }
  const settings = await getSettings();
  const outcome = decide(attempt.toObject(), settings);
  const now = new Date();

  // Compare-and-set: only one concurrent request can evaluate this attempt.
  const claimedAttempt = await Attempt.findOneAndUpdate({ _id: attempt._id, evaluated: false }, { $set: evaluationFields(outcome, settings, now) }, { new: true });
  if (!claimedAttempt) throw AppError.conflict('Second Look was already run for this evidence.');

  const from = inspection.status;
  const updated = await Inspection.findOneAndUpdate(
    { _id: inspection._id, status: STATUS.REINSPECT, deletedAt: null },
    {
      $set: {
        status: outcome.status,
        reviewOpen: !!outcome.reviewType,
        'latest.evaluated': true,
        'latest.evidenceLabel': outcome.evidence.label,
        lastDecision: { rule: outcome.rule, reason: outcome.reason, recommendations: outcome.recommendations, by: user._id, automated: true, at: now },
      },
    },
    { new: true }
  );
  if (!updated) throw AppError.conflict('This inspection was just changed by someone else. Refresh and try again.');

  await logAudit({ inspection: updated, actor: user, action: 'second_look', from, to: outcome.status, rule: outcome.rule, reason: outcome.reason, attemptNumber: attempt.number });
  if (outcome.reviewType) {
    await openReview({ inspection: updated, attempt: claimedAttempt, type: outcome.reviewType, reason: outcome.reason, user: null, automated: true });
    await logAudit({ inspection: updated, actor: null, action: 'review_opened', reason: outcome.reason, meta: { type: outcome.reviewType } });
  }
  return { inspection: updated, attempt: claimedAttempt, outcome };
}

// ---------------------------------------------------------------------------------------------------------------
async function escalate({ inspection, user, reason, note }) {
  if (inspection.status === STATUS.PASSED) throw AppError.conflict('A passed inspection cannot be escalated.');
  if (inspection.status === STATUS.REVIEW || inspection.reviewOpen) throw AppError.conflict('This inspection is already awaiting human review.');
  const from = inspection.status;
  const full = `Escalated by ${user.name}: ${reason}${note ? ` (${note})` : ''}`;
  const now = new Date();

  const updated = await Inspection.findOneAndUpdate(
    { _id: inspection._id, status: from, reviewOpen: false, deletedAt: null },
    { $set: { status: STATUS.REVIEW, reviewOpen: true, lastDecision: { rule: 'MANUAL_ESCALATION', reason: full, recommendations: [], by: user._id, automated: false, at: now } } },
    { new: true }
  );
  if (!updated) throw AppError.conflict('This inspection was just changed by someone else. Refresh and try again.');
  const attempt = await Attempt.findOne({ inspection: updated._id, number: updated.attemptCount });
  try {
    await openReview({ inspection: updated, attempt, type: REVIEW_TYPES.ESCALATION, reason: full, user, automated: false });
  } catch (e) {
    await Inspection.updateOne({ _id: updated._id }, { $set: { status: from, reviewOpen: false } }); // roll back
    throw e;
  }
  await logAudit({ inspection: updated, actor: user, action: 'escalated', from, to: STATUS.REVIEW, rule: 'MANUAL_ESCALATION', reason: full });
  return updated;
}

// ---------------------------------------------------------------------------------------------------------------
async function decideReview({ review, user, decision, verdict, comment }) {
  if (review.status !== 'open') throw AppError.conflict('This review has already been decided.');
  if (review.level === 'admin' && user.role !== 'admin') throw AppError.forbidden('This review was escalated to an administrator.');
  const inspection = await Inspection.findOne({ _id: review.inspection, deletedAt: null });
  if (!inspection) throw AppError.conflict('The inspection for this review no longer exists.');
  const now = new Date();

  if (decision === 'escalate') {
    if (review.level === 'admin') throw AppError.conflict('This review is already escalated to an administrator.');
    const r = await Review.findOneAndUpdate(
      { _id: review._id, status: 'open', level: 'reviewer' },
      { $set: { level: 'admin' }, $push: { history: { action: 'escalate', by: user._id, comment, at: now } } },
      { new: true }
    );
    if (!r) throw AppError.conflict('This review was just changed by someone else. Refresh and try again.');
    await logAudit({ inspection, actor: user, action: 'review_escalated', reason: comment, meta: { reviewId: String(review._id), to: 'admin' } });
    return { review: r, inspection };
  }

  let status;
  if (decision === 'approve') {
    if (review.type === REVIEW_TYPES.ESCALATION) {
      if (!verdict) throw AppError.badRequest('Choose a verdict (pass or defect) when approving an escalated case.', [{ field: 'verdict', message: 'Required' }]);
      if (verdict === 'pass') {
        const attempt = review.attempt
          ? await Attempt.findById(review.attempt)
          : await Attempt.findOne({ inspection: inspection._id, number: inspection.attemptCount });
        const settings = await getSettings();
        const evidence = classifyEvidence(attempt && attempt.quality, settings);
        const anomaly = attempt && attempt.anomaly && attempt.anomaly.score != null ? attempt.anomaly : null;
        const anomalyPassAllowed = !anomaly || (
          Number.isFinite(anomaly.score) && Number.isFinite(anomaly.threshold) && anomaly.threshold > 0 &&
          anomaly.decision === 'normal' && anomaly.score < anomaly.threshold &&
          attempt.modelCategory && anomaly.validation?.category === attempt.modelCategory && anomaly.validation?.status === 'validated' &&
          attempt.source && attempt.source.modelVersion
        );
        if (
          !attempt ||
          attempt.assessmentStatus !== 'assessed' ||
          !attempt.defect ||
          (!anomaly && (typeof attempt.defect.detected !== 'boolean' || typeof attempt.defect.confidence !== 'number')) ||
          !anomalyPassAllowed ||
          evidence.label !== 'Adequate'
        ) {
          throw AppError.conflict('This evidence cannot be approved as passed: a usable model prediction and adequate required quality checks are both needed. Request a recapture or decide as defective.');
        }
      }
      status = verdict === 'pass' ? STATUS.PASSED : STATUS.DEFECT;
    } else {
      if (verdict && verdict !== 'defect') throw AppError.badRequest('A defect sign-off can only be approved as "defect". Use "reject" to overturn it.');
      status = STATUS.DEFECT;
    }
  } else {
    status = STATUS.REINSPECT; // reject or request_recapture
  }

  const decided = await Review.findOneAndUpdate(
    { _id: review._id, status: 'open' },
    {
      $set: { status: 'decided', decision: { action: decision, verdict: decision === 'approve' ? (verdict || 'defect') : undefined, comment, reviewer: user._id, decidedAt: now, resultingStatus: status } },
      $push: { history: { action: decision, by: user._id, comment, at: now } },
    },
    { new: true }
  );
  if (!decided) throw AppError.conflict('This review was just decided by someone else.');

  const from = inspection.status;
  const reason = comment || (decision === 'approve' ? `Approved by ${user.name}.` : '');
  const set = {
    status,
    reviewOpen: false,
    lastDecision: { rule: `REVIEW_${decision.toUpperCase()}`, reason: `${user.name}: ${reason}`, recommendations: [], by: user._id, automated: false, at: now },
  };
  if (decision === 'approve') set.humanVerified = { by: user._id, at: now, verdict: status === STATUS.PASSED ? 'pass' : 'defect' };
  const updated = await Inspection.findOneAndUpdate({ _id: inspection._id }, { $set: set }, { new: true });

  await logAudit({
    inspection: updated,
    actor: user,
    action: 'review_decision',
    from,
    to: status,
    rule: `REVIEW_${decision.toUpperCase()}`,
    reason,
    meta: { reviewId: String(review._id), decision, verdict: decided.decision.verdict, type: review.type },
  });
  return { review: decided, inspection: updated };
}

module.exports = { createInspection, addRecapture, runSecondLook, escalate, decideReview };
