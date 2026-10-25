'use strict';
// Pure decision rules: no database, no I/O. Easy to unit-test and to reason about.
//
// Evidence quality (is the IMAGE good enough?) and model confidence (how sure is the PREDICTION?)
// are separate inputs. A pass is only ever produced when BOTH are good. A blurry image or a failed
// model call can never produce "Passed".
const { STATUS, QUALITY_METRICS, REVIEW_TYPES } = require('../utils/constants');

const HINTS = {
  sharpness: 'Capture a sharper image (hold the camera steady and refocus).',
  lighting: 'Improve the lighting (even and glare-free).',
  alignment: 'Center the component in the frame.',
  visibility: 'Make sure the whole part is visible and not blocked by fixtures.',
};

const pct = (v) => `${Math.round(v)}%`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// -> { label: Adequate | Marginal | Insufficient | Unavailable, weakMetrics: [...], average: number|null }
function classifyEvidence(quality, s) {
  const q = quality || {};
  if (QUALITY_METRICS.some((m) => typeof q[m] !== 'number')) return { label: 'Unavailable', weakMetrics: [], average: null };
  const weakMetrics = QUALITY_METRICS.filter((m) => q[m] < s.minQualityScore);
  const average = QUALITY_METRICS.reduce((a, m) => a + q[m], 0) / QUALITY_METRICS.length;
  if (weakMetrics.length) return { label: 'Insufficient', weakMetrics, average };
  if (average < s.adequateQualityScore) return { label: 'Marginal', weakMetrics, average };
  return { label: 'Adequate', weakMetrics, average };
}

/**
 * @param {{number:number, assessmentStatus:string, quality:object, defect:{detected:boolean|null, confidence:number|null}}} attempt
 * @param {object} settings  confidenceThreshold, minQualityScore, adequateQualityScore, maxAttempts, requireDefectSignoff
 * @returns {{status:string, rule:string, reason:string, recommendations:string[], evidence:object, reviewType:string|null}}
 */
function decide(attempt, settings) {
  const ev = classifyEvidence(attempt.quality, settings);
  const d = attempt.defect || {};
  const base = { evidence: { label: ev.label, weakMetrics: ev.weakMetrics }, recommendations: [], reviewType: null };
  const out = (status, rule, reason, extra = {}) => ({ ...base, status, rule, reason, ...extra });

  // 1. The model failed -> never trust, never auto-pass.
  if (attempt.assessmentStatus !== 'assessed') {
    return out(
      STATUS.REVIEW,
      'ASSESSMENT_FAILED',
      'The automated assessment could not be completed, so no automatic decision was made. A human reviewer must inspect this evidence.',
      { reviewType: REVIEW_TYPES.ESCALATION }
    );
  }
  if (attempt.anomaly && attempt.anomaly.score != null) {
    const a = attempt.anomaly;
    const category = attempt.modelCategory;
    const valid =
      typeof category === 'string' &&
      typeof a.score === 'number' && Number.isFinite(a.score) && a.score >= 0 &&
      typeof a.threshold === 'number' && Number.isFinite(a.threshold) && a.threshold > 0 &&
      typeof a.decision === 'string' &&
      typeof a.scoreSemantics === 'string' && a.scoreSemantics.length > 0 &&
      typeof attempt.source?.modelVersion === 'string' && attempt.source.modelVersion.length > 0 &&
      a.validation?.category === category && a.validation?.status === 'validated';
    if (!valid) {
      return out(STATUS.REVIEW, 'ANOMALY_RESULT_UNVALIDATED', 'The anomaly result is missing its category, validated threshold, or model identity. A human reviewer must decide; this result cannot pass.', {
        reviewType: REVIEW_TYPES.ESCALATION,
      });
    }
    if (ev.label === 'Unavailable') {
      return out(STATUS.REVIEW, 'QUALITY_UNAVAILABLE', 'Image-quality measurements are unavailable, so evidence sufficiency could not be verified. A human reviewer must decide.', {
        reviewType: REVIEW_TYPES.ESCALATION,
      });
    }
    if (ev.label === 'Insufficient') {
      const weak = ev.weakMetrics.map((m) => `${m} ${pct(attempt.quality[m])}`).join(', ');
      const detail = `${cap(weak)} below the minimum of ${pct(settings.minQualityScore)}.`;
      if (attempt.number >= settings.maxAttempts) {
        return out(STATUS.REVIEW, 'MAX_ATTEMPTS_REACHED', `Evidence is still insufficient after ${attempt.number} attempts (limit ${settings.maxAttempts}). ${detail} A human reviewer must decide.`, {
          reviewType: REVIEW_TYPES.ESCALATION,
          recommendations: ev.weakMetrics.map((m) => HINTS[m]),
        });
      }
      return out(STATUS.REINSPECT, 'EVIDENCE_INSUFFICIENT', `Evidence is insufficient. ${detail} Capture a better image before any anomaly decision is made.`, {
        recommendations: ev.weakMetrics.map((m) => HINTS[m]),
      });
    }
    if (a.decision === 'uncertain') {
      return out(STATUS.REVIEW, 'ANOMALY_SCORE_NEAR_THRESHOLD', `The ${category} PatchCore anomaly score (${a.score}) is too close to the calibrated threshold (${a.threshold}) for an automatic decision.`, {
        reviewType: REVIEW_TYPES.ESCALATION,
      });
    }
    const isAnomalous = a.score >= a.threshold;
    if ((a.decision === 'anomalous') !== isAnomalous || !['normal', 'anomalous'].includes(a.decision)) {
      return out(STATUS.REVIEW, 'ANOMALY_DECISION_MISMATCH', 'The model decision does not match its raw score and registered threshold. A human reviewer must decide.', {
        reviewType: REVIEW_TYPES.ESCALATION,
      });
    }
    if (isAnomalous) {
      return out(STATUS.DEFECT, 'ANOMALY_DETECTED', `The ${category} PatchCore anomaly score (${a.score}) met or exceeded its calibrated threshold (${a.threshold}). This score is not a probability. Human sign-off is required.`, {
        reviewType: REVIEW_TYPES.DEFECT_SIGNOFF,
      });
    }
    if (ev.label === 'Marginal') {
      return out(STATUS.REVIEW, 'MARGINAL_EVIDENCE_NO_ANOMALY', `No anomaly exceeded the model threshold, but image evidence is marginal (average ${pct(ev.average)}). A pass requires adequate evidence.`, {
        reviewType: REVIEW_TYPES.ESCALATION,
      });
    }
    return out(STATUS.PASSED, 'PASSED', `Evidence is adequate and the ${category} PatchCore anomaly score (${a.score}) is below its calibrated threshold (${a.threshold}). The score is not a probability.`);
  }
  // 2. No usable prediction.
  if (typeof d.confidence !== 'number' || typeof d.detected !== 'boolean') {
    const detail = attempt.assessmentError ? ` ${String(attempt.assessmentError).slice(0, 300)}` : '';
    return out(STATUS.REVIEW, 'NO_PREDICTION', `The model did not return a usable prediction.${detail} A human reviewer must inspect this evidence.`, {
      reviewType: REVIEW_TYPES.ESCALATION,
    });
  }
  // 3. Cannot verify the evidence itself.
  if (ev.label === 'Unavailable') {
    return out(
      STATUS.REVIEW,
      'QUALITY_UNAVAILABLE',
      'Image-quality scores are not available, so evidence sufficiency could not be verified. A human reviewer must decide.',
      { reviewType: REVIEW_TYPES.ESCALATION }
    );
  }
  // 4. Evidence insufficient -> recapture (or a human once the attempt limit is reached).
  if (ev.label === 'Insufficient') {
    const weak = ev.weakMetrics.map((m) => `${m} ${pct(attempt.quality[m])}`).join(', ');
    const detail = `${cap(weak)} below the minimum of ${pct(settings.minQualityScore)}.`;
    if (attempt.number >= settings.maxAttempts) {
      return out(
        STATUS.REVIEW,
        'MAX_ATTEMPTS_REACHED',
        `Evidence is still insufficient after ${attempt.number} attempts (limit ${settings.maxAttempts}). ${detail} A human reviewer must decide.`,
        { reviewType: REVIEW_TYPES.ESCALATION, recommendations: ev.weakMetrics.map((m) => HINTS[m]) }
      );
    }
    return out(STATUS.REINSPECT, 'EVIDENCE_INSUFFICIENT', `Evidence is insufficient. ${detail} Capture a better image before any decision is made.`, {
      recommendations: ev.weakMetrics.map((m) => HINTS[m]),
    });
  }
  // 5. Evidence fine, prediction uncertain -> human.
  if (d.confidence < settings.confidenceThreshold) {
    return out(
      STATUS.REVIEW,
      'LOW_CONFIDENCE',
      `Evidence is sufficient but model confidence (${pct(d.confidence)}) is below the ${pct(settings.confidenceThreshold)} threshold. This uncertain case needs a human reviewer.`,
      { reviewType: REVIEW_TYPES.ESCALATION }
    );
  }
  // 6. Confident defect.
  if (d.detected) {
    if (ev.label === 'Marginal') {
      return out(STATUS.REVIEW, 'MARGINAL_EVIDENCE_DEFECT', `A defect was predicted, but evidence quality is only marginal (average ${pct(ev.average)}). Human review is required before confirmation.`, {
        reviewType: REVIEW_TYPES.ESCALATION,
      });
    }
    const signoff = !!settings.requireDefectSignoff;
    return out(
      STATUS.DEFECT,
      'DEFECT_CONFIRMED',
      `A defect was predicted with ${pct(d.confidence)} confidence on ${ev.label.toLowerCase()} evidence.` +
        (signoff ? ' Confirmed defects require human sign-off.' : ''),
      { reviewType: signoff ? REVIEW_TYPES.DEFECT_SIGNOFF : null }
    );
  }
  // 7. Confident "no defect" -> only on ADEQUATE evidence.
  if (ev.label === 'Marginal') {
    return out(
      STATUS.REVIEW,
      'MARGINAL_EVIDENCE_NO_DEFECT',
      `No defect was predicted, but evidence quality is only marginal (average ${pct(ev.average)}). A pass requires adequate evidence, so a human reviewer must confirm.`,
      { reviewType: REVIEW_TYPES.ESCALATION }
    );
  }
  return out(
    STATUS.PASSED,
    'PASSED',
    `Evidence is adequate and no defect was found (confidence ${pct(d.confidence)} meets the ${pct(settings.confidenceThreshold)} threshold).`
  );
}

module.exports = { decide, classifyEvidence, HINTS };
