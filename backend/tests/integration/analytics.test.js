const Inspection = require('../../models/Inspection');
const Attempt = require('../../models/Attempt');
const { startDb, stopDb, clearDb, makeApi, createUsers, useModel, resetModel, R, GOOD, BAD } = require('../helpers/app');

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

// 1 Passed, 1 Defect Confirmed, 1 Reinspection Required, 1 Awaiting Human Review
async function seedFour() {
  useModel(R(GOOD, 95, false), R(GOOD, 88, true), R(BAD, 80, false), R(GOOD, 60, false));
  for (const n of ['Pass', 'Defect', 'Blurry', 'Unsure']) await api.newInspection(u.inspector.token, `${n} part`);
}

describe('dashboard', () => {
  test('is zero on an empty database', async () => {
    const r = await api.get('/analytics/dashboard', u.admin.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 0, reinspectionRequired: 0, awaitingHumanReview: 0, defectConfirmed: 0, passed: 0 });
  });

  test('counts come from the database and update when records change', async () => {
    await seedFour();
    let d = (await api.get('/analytics/dashboard', u.admin.token)).body.data;
    expect(d).toMatchObject({ total: 4, passed: 1, defectConfirmed: 1, reinspectionRequired: 1, awaitingHumanReview: 1, openReviews: 2 });

    // fix the blurry one: recapture + second look -> Passed
    useModel(R(GOOD, 96, false));
    const code = (await Inspection.findOne({ componentName: 'Blurry part' })).code;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' });
    d = (await api.get('/analytics/dashboard', u.admin.token)).body.data;
    expect(d).toMatchObject({ total: 4, passed: 2, reinspectionRequired: 0 });
  });

  test('is scoped: an inspector only counts their own', async () => {
    useModel(R(GOOD, 95, false), R(GOOD, 95, false));
    await api.newInspection(u.inspector.token, 'Mine');
    await api.newInspection(u.inspector2.token, 'Theirs');
    expect((await api.get('/analytics/dashboard', u.inspector.token)).body.data.total).toBe(1);
    expect((await api.get('/analytics/dashboard', u.admin.token)).body.data.total).toBe(2);
  });
});

describe('analytics summary', () => {
  test('totals, rates and review workload are computed from stored records', async () => {
    await seedFour();
    const s = (await api.get('/analytics/summary', u.admin.token)).body.data;
    expect(s.totals).toEqual({ total: 4, passed: 1, defectConfirmed: 1, reinspectionRequired: 1, awaitingHumanReview: 1 });
    expect(s.rates.passRate).toBe(50); // 1 passed of 2 finalised (pass + defect)
    expect(s.rates.defectConfirmationRate).toBe(50);
    expect(s.rates.reinspectionRate).toBe(0); // nobody needed a recapture yet
    expect(s.reviewWorkload.open).toBe(2);
    expect(s.reviewWorkload.decidedInRange).toBe(0);
    expect(s.volumeByDay.reduce((a, d) => a + d.count, 0)).toBe(4);
  });

  test('rates are null (not 0%) when there is nothing to divide by', async () => {
    const s = (await api.get('/analytics/summary', u.admin.token)).body.data;
    expect(s.rates.passRate).toBeNull();
    expect(s.rates.reinspectionRate).toBeNull();
  });

  test('evidence issues count weak metrics; reinspection rate and weekly recaptures update after a recapture', async () => {
    await seedFour(); // BAD = sharpness 30, lighting 40 (both < 60)
    let s = (await api.get('/analytics/summary', u.admin.token)).body.data;
    expect(s.evidenceIssues.counts).toMatchObject({ sharpness: 1, lighting: 1, alignment: 0, visibility: 0 });
    expect(s.evidenceIssues.attemptsAssessed).toBe(4);

    const code = (await Inspection.findOne({ componentName: 'Blurry part' })).code;
    useModel(R(GOOD, 95, false));
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    s = (await api.get('/analytics/summary', u.admin.token)).body.data;
    expect(s.rates.reinspectionRate).toBe(25);
    expect(s.rates.inspectionsWithRecapture).toBe(1);
    expect(s.recapturesByWeek.reduce((a, w) => a + w.count, 0)).toBe(1);
  });

  test('failed assessments are counted separately', async () => {
    useModel(new Error('down'));
    await api.newInspection(u.inspector.token, 'Broken');
    const s = (await api.get('/analytics/summary', u.admin.token)).body.data;
    expect(s.evidenceIssues.failedAssessments).toBe(1);
    expect(s.evidenceIssues.attemptsAssessed).toBe(0);
  });

  test('date filters: future window is empty; a window covering today includes everything; backdated records are excluded', async () => {
    await seedFour();
    const day = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const lastWeek = new Date(today.getTime() - 7 * 86400000);
    expect((await api.get(`/analytics/summary?from=${day(tomorrow)}`, u.admin.token)).body.data.totals.total).toBe(0);
    expect((await api.get(`/analytics/summary?from=${day(lastWeek)}&to=${day(today)}`, u.admin.token)).body.data.totals.total).toBe(4);

    const old = await Inspection.findOne({ componentName: 'Pass part' });
    await Inspection.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(today.getTime() - 40 * 86400000) } });
    await Attempt.collection.updateMany({ inspection: old._id }, { $set: { createdAt: new Date(today.getTime() - 40 * 86400000) } });
    const recent = (await api.get(`/analytics/summary?from=${day(lastWeek)}&to=${day(today)}`, u.admin.token)).body.data;
    expect(recent.totals.total).toBe(3);
    expect(recent.totals.passed).toBe(0);
    expect((await api.get('/analytics/summary', u.admin.token)).body.data.totals.total).toBe(4); // no filter = all time
  });

  test('invalid dates -> 400', async () => {
    expect((await api.get('/analytics/summary?from=banana', u.admin.token)).status).toBe(400);
    expect((await api.get('/analytics/summary?from=2030-01-02&to=2030-01-01', u.admin.token)).status).toBe(400);
  });

  test('review workload reflects decisions per reviewer', async () => {
    await seedFour();
    const q = await api.get('/reviews', u.reviewer.token);
    const first = q.body.data[0];
    expect(first.type).toBe('defect_signoff'); // oldest open review is the defect sign-off
    const done = await api.post(`/reviews/${first.id}/decision`, u.reviewer.token, { decision: 'approve', comment: 'Confirmed on site' });
    expect(done.status).toBe(200);
    const s = (await api.get('/analytics/summary', u.admin.token)).body.data;
    expect(s.reviewWorkload).toMatchObject({ open: 1, decidedInRange: 1, byDecision: { approve: 1 } });
    expect(s.reviewWorkload.byReviewer).toEqual([{ reviewerId: u.reviewer.id, name: 'Rae Reviewer', decided: 1 }]);
    expect(s.reviewWorkload.avgDecisionHours).toEqual(expect.any(Number));
  });
});

describe('evidence history endpoint', () => {
  test('lists every attempt across inspections with paging, search and scope', async () => {
    useModel(R(BAD, 80, false), R(GOOD, 95, false), R(GOOD, 95, false));
    const code = (await api.newInspection(u.inspector.token, 'Alpha')).body.data.inspection.code;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    await api.newInspection(u.inspector2.token, 'Beta');

    const all = await api.get('/evidence', u.admin.token);
    expect(all.body.meta.total).toBe(3);
    expect(all.body.data[0].inspection.code).toBeTruthy();
    expect((await api.get('/evidence', u.inspector.token)).body.meta.total).toBe(2); // own attempts only
    expect((await api.get('/evidence?q=beta', u.admin.token)).body.meta.total).toBe(1);
    expect((await api.get('/evidence?limit=2&page=2', u.admin.token)).body.data).toHaveLength(1);
    expect((await api.get('/evidence?status=Reinspection%20Required', u.admin.token)).body.meta.total).toBe(2);
  });
});

describe('health', () => {
  test('reports the database as connected', async () => {
    const r = await api.raw().get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'ok', database: 'connected' });
  });
});
