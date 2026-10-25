const Inspection = require('../../models/Inspection');
const Attempt = require('../../models/Attempt');
const Review = require('../../models/Review');
const AuditLog = require('../../models/AuditLog');
const { startDb, stopDb, clearDb, makeApi, createUsers, useModel, resetModel, R, Q, GOOD, BAD } = require('../helpers/app');

const api = makeApi();
let u;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  useModel();
  u = await createUsers(api);
});
afterEach(async () => {
  resetModel();
  await clearDb();
});

const create = async (result, name = 'Part') => {
  useModel(result);
  return (await api.newInspection(u.inspector.token, name)).body.data;
};
const openReview = (code) => Inspection.findOne({ code }).then((i) => Review.findOne({ inspection: i._id, status: 'open' }));
const decide = (reviewId, token, body) => api.post(`/reviews/${reviewId}/decision`, token, body);

describe('safe handling of model problems', () => {
  test('model error -> Awaiting Human Review, stored as failed, NEVER Passed', async () => {
    const d = await create(new Error('model service down'));
    expect(d.inspection.status).toBe('Awaiting Human Review');
    expect(d.outcome.rule).toBe('ASSESSMENT_FAILED');
    expect(d.attempt.assessmentStatus).toBe('failed');
    expect(d.attempt.quality.sharpness).toBeNull();
    expect(d.attempt.defect.confidence).toBeNull();
    expect(await openReview(d.inspection.code)).toBeTruthy();
  });

  test('invalid model output (confidence 250) is treated as a failure', async () => {
    const d = await create({ modelVersion: 'x', quality: GOOD, defect: { detected: false, confidence: 250 } });
    expect(d.inspection.status).toBe('Awaiting Human Review');
    expect(d.attempt.assessmentStatus).toBe('failed');
    expect(d.attempt.assessmentError).toMatch(/invalid response/i);
  });

  test('an unavailable measurement is stored as null (not 0) and sends the case to a human', async () => {
    const d = await create(R(Q(90, 90, 90, null), 96, false));
    expect(d.attempt.quality.visibility).toBeNull();
    expect(d.attempt.evidence.label).toBe('Unavailable');
    expect(d.inspection.status).toBe('Awaiting Human Review');
    expect(d.outcome.rule).toBe('QUALITY_UNAVAILABLE');
  });

  test('blurry image with a very confident "no defect" is never a pass', async () => {
    const d = await create(R(Q(15, 90, 90, 90), 99, false));
    expect(d.inspection.status).toBe('Reinspection Required');
    expect(d.attempt.defect.confidence).toBe(99); // confidence is kept separate from evidence quality
    expect(d.attempt.evidence.label).toBe('Insufficient');
  });

  test('uncertain case -> human review; reason mentions confidence and threshold', async () => {
    const d = await create(R(GOOD, 67, false));
    expect(d.inspection.status).toBe('Awaiting Human Review');
    expect(d.outcome.reason).toMatch(/67%.*80%/);
  });
});

describe('human review', () => {
  test('defect needs sign-off: reviewer approval persists comment, reviewer and time', async () => {
    const d = await create(R(GOOD, 88, true));
    expect(d.inspection.status).toBe('Defect Confirmed');
    expect(d.inspection.reviewOpen).toBe(true);
    const rv = await openReview(d.inspection.code);
    expect(rv.type).toBe('defect_signoff');

    const r = await decide(rv.id, u.reviewer.token, { decision: 'approve', comment: 'Scratch is clearly visible' });
    expect(r.status).toBe(200);
    const saved = await Review.findById(rv.id);
    expect(saved.status).toBe('decided');
    expect(saved.decision).toMatchObject({ action: 'approve', comment: 'Scratch is clearly visible', resultingStatus: 'Defect Confirmed' });
    expect(String(saved.decision.reviewer)).toBe(u.reviewer.id);
    expect(saved.decision.decidedAt).toBeInstanceOf(Date);

    const insp = await Inspection.findOne({ code: d.inspection.code });
    expect(insp.reviewOpen).toBe(false);
    expect(String(insp.humanVerified.by)).toBe(u.reviewer.id);
    const audit = await AuditLog.findOne({ inspection: insp._id, action: 'review_decision' });
    expect(audit.actorName).toBe('Rae Reviewer');
    expect(audit.reason).toBe('Scratch is clearly visible');
  });

  test('deciding twice -> 409', async () => {
    const d = await create(R(GOOD, 88, true));
    const rv = await openReview(d.inspection.code);
    expect((await decide(rv.id, u.reviewer.token, { decision: 'approve' })).status).toBe(200);
    expect((await decide(rv.id, u.reviewer.token, { decision: 'reject', comment: 'changed my mind' })).status).toBe(409);
  });

  test('escalated case needs a verdict; "pass" and "defect" map to final statuses', async () => {
    const pass = await create(R(GOOD, 60, false), 'P1');
    const defect = await create(R(GOOD, 60, true), 'P2');
    const rvPass = await openReview(pass.inspection.code);
    const rvDef = await openReview(defect.inspection.code);
    expect((await decide(rvPass.id, u.reviewer.token, { decision: 'approve' })).status).toBe(400); // verdict missing
    expect((await decide(rvPass.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' })).status).toBe(200);
    expect((await decide(rvDef.id, u.reviewer.token, { decision: 'approve', verdict: 'defect' })).status).toBe(200);
    expect((await Inspection.findOne({ code: pass.inspection.code })).status).toBe('Passed');
    expect((await Inspection.findOne({ code: defect.inspection.code })).status).toBe('Defect Confirmed');
  });

  test('reviewers cannot pass failed or insufficient evidence', async () => {
    const failed = await create(new Error('model service down'), 'Failed evidence');
    const failedReview = await openReview(failed.inspection.code);
    const failedPass = await decide(failedReview.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' });
    expect(failedPass.status).toBe(409);
    expect((await Review.findById(failedReview.id)).status).toBe('open');

    const unavailable = await create(R(Q(90, 90, 90, null), 95, false), 'Unavailable quality');
    const unavailableReview = await openReview(unavailable.inspection.code);
    const unavailablePass = await decide(unavailableReview.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' });
    expect(unavailablePass.status).toBe(409);
    expect((await Inspection.findOne({ code: unavailable.inspection.code })).status).toBe('Awaiting Human Review');

    const marginal = await create(R(Q(70, 72, 75, 78), 95, false), 'Marginal quality');
    const marginalReview = await openReview(marginal.inspection.code);
    expect((await decide(marginalReview.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' })).status).toBe(409);
  });

  test('quality-only provider stores real metrics but requests human review without a prediction', async () => {
    const qualityMeasurements = { sharpness: { value: 42.5, unit: 'Laplacian variance' } };
    const result = await create({
      qualityOnly: true,
      modelVersion: 'opencv-quality-v1',
      quality: Q(90, 90, 90, 90),
      defect: null,
      errors: ['No compatible defect-detection model or weights are configured; no prediction was made.'],
      metadata: { qualityMeasurements },
    }, 'CV quality only');
    expect(result.inspection.status).toBe('Awaiting Human Review');
    expect(result.outcome.rule).toBe('NO_PREDICTION');
    expect(result.outcome.reason).toMatch(/does not include defect inference/i);
    expect(result.attempt.qualityMeasurements).toEqual(qualityMeasurements);
    expect(result.attempt.defect.confidence).toBeNull();
    const review = await openReview(result.inspection.code);
    expect((await decide(review.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' })).status).toBe(409);
  });

  test('PatchCore anomaly score is stored as a raw score and requires defect sign-off', async () => {
    const result = await create({
      task: 'patchcore_anomaly_detection',
      modelVersion: 'patchcore-pcb1-v1',
      modelCategory: 'pcb1',
      quality: Q(90, 90, 90, 90),
      anomaly: {
        score: 0.72,
        threshold: 0.5,
        decision: 'anomalous',
        scoreSemantics: 'PatchCore nearest-neighbor anomaly score; not a probability.',
        localization: { x: 0.2, y: 0.25, w: 0.3, h: 0.2 },
        validation: { category: 'pcb1', status: 'validated', dataset: 'VisA', evaluatedAt: '2026-10-25' },
      },
    }, 'PCB anomaly');
    expect(result.inspection.status).toBe('Defect Confirmed');
    expect(result.attempt.modelCategory).toBe('pcb1');
    expect(result.attempt.anomaly).toMatchObject({ score: 0.72, threshold: 0.5, decision: 'anomalous' });
    expect(result.attempt.defect.confidence).toBeNull();
    const review = await openReview(result.inspection.code);
    expect(review.type).toBe('defect_signoff');
    expect((await decide(review.id, u.reviewer.token, { decision: 'approve' })).status).toBe(200);
    expect((await Inspection.findOne({ code: result.inspection.code })).status).toBe('Defect Confirmed');
  });

  test('reject and request_recapture reopen the inspection for recapture and require a comment', async () => {
    for (const decision of ['reject', 'request_recapture']) {
      const d = await create(R(GOOD, 88, true), decision);
      const rv = await openReview(d.inspection.code);
      expect((await decide(rv.id, u.reviewer.token, { decision })).status).toBe(400);
      const ok = await decide(rv.id, u.reviewer.token, { decision, comment: 'Image does not show the weld' });
      expect(ok.status).toBe(200);
      const insp = await Inspection.findOne({ code: d.inspection.code });
      expect(insp.status).toBe('Reinspection Required');
      useModel(R(GOOD, 95, false));
      expect((await api.upload(`/inspections/${d.inspection.code}/recapture`, u.inspector.token)).status).toBe(201);
    }
  });

  test('reviewer escalation moves a review to admin level; only admin can then decide', async () => {
    const d = await create(R(GOOD, 60, false));
    const rv = await openReview(d.inspection.code);
    expect((await decide(rv.id, u.reviewer.token, { decision: 'escalate', comment: 'Needs plant manager' })).status).toBe(200);
    expect((await Review.findById(rv.id)).level).toBe('admin');
    expect((await decide(rv.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' })).status).toBe(403);
    expect((await decide(rv.id, u.reviewer.token, { decision: 'escalate', comment: 'again' })).status).toBe(403); // no longer theirs to act on
    expect((await decide(rv.id, u.admin.token, { decision: 'escalate', comment: 'nowhere higher to go' })).status).toBe(409);
    expect((await decide(rv.id, u.admin.token, { decision: 'approve', verdict: 'pass' })).status).toBe(200);
    expect((await Review.findById(rv.id)).history.map((h) => h.action)).toEqual(['escalate', 'approve']);
  });

  test('a defect sign-off can only be approved as "defect"', async () => {
    const d = await create(R(GOOD, 88, true));
    const rv = await openReview(d.inspection.code);
    const bad = await decide(rv.id, u.reviewer.token, { decision: 'approve', verdict: 'pass' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/only be approved as "defect"/);
    expect((await Review.findById(rv.id)).status).toBe('open');
  });

  test('review queue lists open reviews oldest first, with evidence history available', async () => {
    const a = await create(R(GOOD, 60, false), 'First');
    const b = await create(R(GOOD, 88, true), 'Second');
    const q = await api.get('/reviews', u.reviewer.token);
    expect(q.status).toBe(200);
    expect(q.body.data.map((r) => r.inspection.componentName)).toEqual(['First', 'Second']);
    expect(q.body.meta.total).toBe(2);
    const detail = await api.get(`/reviews/${q.body.data[0].id}`, u.reviewer.token);
    expect(detail.body.data.attempts).toHaveLength(1);
    expect(detail.body.data.audit.length).toBeGreaterThan(2);
    expect((await api.get('/reviews?type=defect_signoff', u.reviewer.token)).body.data).toHaveLength(1);
    await decide(q.body.data[0].id, u.reviewer.token, { decision: 'approve', verdict: 'pass' });
    expect((await api.get('/reviews', u.reviewer.token)).body.data).toHaveLength(1);
    expect((await api.get('/reviews?status=decided', u.reviewer.token)).body.data).toHaveLength(1);
    expect(a && b).toBeTruthy();
  });
});

describe('manual escalation by the inspector', () => {
  test('moves an inspection to human review and opens exactly one review', async () => {
    const d = await create(R(BAD, 80, false));
    const code = d.inspection.code;
    expect((await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'escalate' })).status).toBe(400); // reason required
    const r = await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'escalate', reason: 'Evidence still insufficient', note: 'Fixture blocks view' });
    expect(r.status).toBe(200);
    expect(r.body.data.inspection.status).toBe('Awaiting Human Review');
    expect(await Review.countDocuments({ status: 'open' })).toBe(1);
    expect((await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'escalate', reason: 'again please' })).status).toBe(409);
    const audit = await AuditLog.findOne({ action: 'escalated' });
    expect(audit.actorName).toBe('Ivy Inspector');
  });

  test('a passed inspection cannot be escalated', async () => {
    const d = await create(R(GOOD, 95, false));
    expect((await api.post(`/inspections/${d.inspection.code}/decision`, u.inspector.token, { action: 'escalate', reason: 'just because' })).status).toBe(409);
  });
});

describe('role restrictions', () => {
  test('only reviewers/admins can use the review endpoints', async () => {
    const d = await create(R(GOOD, 88, true));
    const rv = await openReview(d.inspection.code);
    expect((await api.get('/reviews', u.inspector.token)).status).toBe(403);
    expect((await api.get(`/reviews/${rv.id}`, u.inspector.token)).status).toBe(403);
    expect((await decide(rv.id, u.inspector.token, { decision: 'approve' })).status).toBe(403);
    expect((await decide(rv.id, null, { decision: 'approve' })).status).toBe(401);
    expect((await Review.findById(rv.id)).status).toBe('open'); // nothing changed
  });

  test('reviewers cannot create inspections, recapture or run Second Look; other inspectors cannot touch them', async () => {
    const d = await create(R(BAD, 80, false));
    const code = d.inspection.code;
    expect((await api.post(`/inspections/${code}/decision`, u.reviewer.token, { action: 'second_look' })).status).toBe(403);
    expect((await api.post(`/inspections/${code}/decision`, u.inspector2.token, { action: 'second_look' })).status).toBe(404);
    expect((await api.post(`/inspections/${code}/decision`, u.inspector2.token, { action: 'escalate', reason: 'nope nope' })).status).toBe(404);
    expect((await api.post(`/inspections/${code}/decision`, u.admin.token, { action: 'escalate', reason: 'admin override' })).status).toBe(200);
  });

  test('invalid decision payloads -> 400', async () => {
    const d = await create(R(BAD, 80, false));
    expect((await api.post(`/inspections/${d.inspection.code}/decision`, u.inspector.token, { action: 'approve_everything' })).status).toBe(400);
    expect((await api.post('/reviews/not-an-id/decision', u.reviewer.token, { decision: 'approve' })).status).toBe(400);
    expect((await api.post('/reviews/507f1f77bcf86cd799439011/decision', u.reviewer.token, { decision: 'approve' })).status).toBe(404);
  });
});

describe('configurable rules', () => {
  test('admin threshold change affects new decisions; inspectors cannot change settings', async () => {
    expect((await api.put('/settings/app', u.inspector.token, { confidenceThreshold: 95 })).status).toBe(403);
    const upd = await api.put('/settings/app', u.admin.token, { confidenceThreshold: 97 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.app.confidenceThreshold).toBe(97);
    const d = await create(R(GOOD, 95, false)); // would have passed at the default 80
    expect(d.inspection.status).toBe('Awaiting Human Review');
    expect((await api.get('/settings', u.inspector.token)).body.data.app.confidenceThreshold).toBe(97);
    expect(await AuditLog.countDocuments({ action: 'settings_updated' })).toBe(1);
  });

  test('settings validation: range, unknown keys, min < adequate', async () => {
    expect((await api.put('/settings/app', u.admin.token, { confidenceThreshold: 10 })).status).toBe(400);
    expect((await api.put('/settings/app', u.admin.token, { confidenceThreshold: 'high' })).status).toBe(400);
    expect((await api.put('/settings/app', u.admin.token, { evil: true })).status).toBe(400);
    expect((await api.put('/settings/app', u.admin.token, {})).status).toBe(400);
    expect((await api.put('/settings/app', u.admin.token, { minQualityScore: 90, adequateQualityScore: 80 })).status).toBe(400);
  });

  test('requireDefectSignoff=false skips the sign-off review', async () => {
    await api.put('/settings/app', u.admin.token, { requireDefectSignoff: false });
    const d = await create(R(GOOD, 90, true));
    expect(d.inspection.status).toBe('Defect Confirmed');
    expect(d.inspection.reviewOpen).toBe(false);
    expect(await Review.countDocuments()).toBe(0);
  });

  test('reaching maxAttempts sends still-insufficient evidence to a human', async () => {
    await api.put('/settings/app', u.admin.token, { maxAttempts: 2 });
    useModel(R(BAD, 80, false), R(BAD, 80, false));
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    const sl = await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' });
    expect(sl.body.data.outcome.rule).toBe('MAX_ATTEMPTS_REACHED');
    expect(sl.body.data.inspection.status).toBe('Awaiting Human Review');
  });

  test('personal settings: name and theme; invalid theme rejected', async () => {
    const ok = await api.patch('/settings/me', u.inspector.token, { name: 'Ivy I.', preferences: { theme: 'dark' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.me).toMatchObject({ name: 'Ivy I.', preferences: { theme: 'dark' } });
    expect((await api.patch('/settings/me', u.inspector.token, { preferences: { theme: 'neon' } })).status).toBe(400);
    expect((await api.patch('/settings/me', u.inspector.token, { role: 'admin' })).status).toBe(400);
  });
});

describe('concurrency', () => {
  test('two simultaneous Second Look calls: exactly one wins', async () => {
    useModel(R(BAD, 80, false), R(GOOD, 95, false));
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    const [a, b] = await Promise.all([
      api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' }),
      api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await AuditLog.countDocuments({ action: 'second_look' })).toBe(1);
    expect(await Attempt.countDocuments({ evaluated: true })).toBe(2);
  });
});
