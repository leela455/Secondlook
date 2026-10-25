const { decide, classifyEvidence } = require('../../services/decisionService');
const { STATUS } = require('../../utils/constants');

const S = { confidenceThreshold: 80, minQualityScore: 60, adequateQualityScore: 80, maxAttempts: 3, requireDefectSignoff: true };
const q = (sharpness, lighting, alignment, visibility) => ({ sharpness, lighting, alignment, visibility });
const attempt = (quality, confidence, detected, extra = {}) => ({ number: 1, assessmentStatus: 'assessed', quality, defect: { detected, confidence }, ...extra });

describe('classifyEvidence', () => {
  test('adequate / marginal / insufficient / unavailable', () => {
    expect(classifyEvidence(q(90, 90, 90, 90), S).label).toBe('Adequate');
    expect(classifyEvidence(q(70, 72, 75, 78), S).label).toBe('Marginal');
    expect(classifyEvidence(q(95, 95, 95, 40), S).label).toBe('Insufficient'); // one weak metric is enough
    expect(classifyEvidence(q(95, 95, 95, null), S).label).toBe('Unavailable');
    expect(classifyEvidence(undefined, S).label).toBe('Unavailable');
  });
  test('reports which metrics are weak', () => {
    expect(classifyEvidence(q(34, 41, 70, 78), S).weakMetrics).toEqual(['sharpness', 'lighting']);
  });
});

describe('decide: Second Look rules', () => {
  test('adequate evidence + confident "no defect" -> Passed', () => {
    const r = decide(attempt(q(92, 90, 94, 95), 96, false), S);
    expect(r.status).toBe(STATUS.PASSED);
    expect(r.rule).toBe('PASSED');
    expect(r.reviewType).toBeNull();
  });

  test('blurry image can NEVER pass, even with very high model confidence', () => {
    const r = decide(attempt(q(20, 90, 90, 90), 99, false), S);
    expect(r.status).toBe(STATUS.REINSPECT);
    expect(r.rule).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.recommendations.join(' ')).toMatch(/sharper/i);
  });

  test('recommendations match the weak metrics', () => {
    const r = decide(attempt(q(34, 41, 70, 78), 61, true), S);
    expect(r.recommendations).toHaveLength(2);
    expect(r.recommendations.join(' ')).toMatch(/sharper/i);
    expect(r.recommendations.join(' ')).toMatch(/lighting/i);
  });

  test('failed model call -> human review, never Passed', () => {
    const r = decide({ number: 1, assessmentStatus: 'failed', quality: q(null, null, null, null), defect: { detected: null, confidence: null } }, S);
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.rule).toBe('ASSESSMENT_FAILED');
    expect(r.reviewType).toBe('escalation');
  });

  test('missing prediction or missing quality scores -> human review', () => {
    expect(decide(attempt(q(90, 90, 90, 90), null, null), S).rule).toBe('NO_PREDICTION');
    expect(decide(attempt(q(90, 90, 90, null), 95, false), S).rule).toBe('QUALITY_UNAVAILABLE');
    expect(decide(attempt(q(90, 90, 90, null), 95, false), S).status).toBe(STATUS.REVIEW);
  });

  test('missing model prediction includes a safe technical diagnostic', () => {
    const r = decide({ ...attempt(q(90, 90, 90, 90), null, null), assessmentError: 'This quality-only provider does not include defect inference; no prediction was made.' }, S);
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.reason).toMatch(/does not include defect inference/i);
  });

  test('PatchCore anomaly score is compared to its validated threshold, not treated as confidence', () => {
    const anomalyAttempt = (score, decision) => ({
      number: 1,
      assessmentStatus: 'assessed',
      modelCategory: 'pcb1',
      quality: q(90, 90, 90, 90),
      defect: { detected: decision === 'anomalous', confidence: null },
      anomaly: {
        score,
        threshold: 0.5,
        decision,
        scoreSemantics: 'PatchCore nearest-neighbor anomaly score; not a probability.',
        validation: { category: 'pcb1', status: 'validated' },
      },
      source: { modelVersion: 'patchcore-pcb1-v1' },
    });
    expect(decide(anomalyAttempt(0.2, 'normal'), S).status).toBe(STATUS.PASSED);
    expect(decide(anomalyAttempt(0.8, 'anomalous'), { ...S, requireDefectSignoff: false })).toMatchObject({ status: STATUS.DEFECT, reviewType: 'defect_signoff' });
    expect(decide(anomalyAttempt(0.5, 'uncertain'), S).status).toBe(STATUS.REVIEW);
  });

  test('unvalidated anomaly result cannot pass', () => {
    const attempt = {
      number: 1,
      assessmentStatus: 'assessed',
      modelCategory: 'pcb1',
      quality: q(90, 90, 90, 90),
      anomaly: { score: 0.1, threshold: 0.5, decision: 'normal', scoreSemantics: 'raw score' },
      source: { modelVersion: 'unvalidated' },
    };
    const result = decide(attempt, S);
    expect(result.status).toBe(STATUS.REVIEW);
    expect(result.rule).toBe('ANOMALY_RESULT_UNVALIDATED');
  });

  test('good evidence but low confidence -> human review (uncertain case)', () => {
    const r = decide(attempt(q(90, 90, 90, 90), 67, false), S);
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.rule).toBe('LOW_CONFIDENCE');
  });

  test('confidence exactly at the threshold is accepted', () => {
    expect(decide(attempt(q(90, 90, 90, 90), 80, false), S).status).toBe(STATUS.PASSED);
    expect(decide(attempt(q(90, 90, 90, 90), 79.9, false), S).status).toBe(STATUS.REVIEW);
  });

  test('marginal evidence + "no defect" is not auto-passed', () => {
    const r = decide(attempt(q(70, 72, 75, 78), 95, false), S);
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.rule).toBe('MARGINAL_EVIDENCE_NO_DEFECT');
  });

  test('confident defect -> Defect Confirmed with mandatory sign-off', () => {
    const r = decide(attempt(q(85, 82, 90, 91), 88, true), S);
    expect(r.status).toBe(STATUS.DEFECT);
    expect(r.reviewType).toBe('defect_signoff');
  });

  test('sign-off can be switched off in settings', () => {
    const r = decide(attempt(q(85, 82, 90, 91), 88, true), { ...S, requireDefectSignoff: false });
    expect(r.status).toBe(STATUS.DEFECT);
    expect(r.reviewType).toBeNull();
  });

  test('insufficient evidence after maxAttempts goes to a human instead of looping forever', () => {
    const r = decide(attempt(q(30, 90, 90, 90), 90, false, { number: 3 }), S);
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.rule).toBe('MAX_ATTEMPTS_REACHED');
    expect(decide(attempt(q(30, 90, 90, 90), 90, false, { number: 2 }), S).status).toBe(STATUS.REINSPECT);
  });

  test('thresholds come from settings, not constants', () => {
    const a = attempt(q(90, 90, 90, 90), 85, false);
    expect(decide(a, S).status).toBe(STATUS.PASSED);
    expect(decide(a, { ...S, confidenceThreshold: 90 }).status).toBe(STATUS.REVIEW);
  });

  test('every outcome carries a human-readable reason', () => {
    [attempt(q(92, 90, 94, 95), 96, false), attempt(q(20, 90, 90, 90), 99, false), attempt(q(90, 90, 90, 90), 60, false)].forEach((a) => {
      expect(decide(a, S).reason.length).toBeGreaterThan(20);
    });
  });
});
