'use strict';
// All numbers here are computed from stored records at request time. Nothing is hard-coded.
// Days and weeks are bucketed in UTC (weeks start on Monday).
const Inspection = require('../models/Inspection');
const Attempt = require('../models/Attempt');
const Review = require('../models/Review');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { STATUS, STATUS_LIST, QUALITY_METRICS } = require('../utils/constants');
const { scopeFilter } = require('./scope');
const { getSettings } = require('./settingsService');

const DAY = 86400000;

function parseRange({ from, to } = {}) {
  const r = {};
  if (from) r.from = new Date(from);
  if (to) r.to = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(new Date(to).getTime() + DAY - 1) : new Date(to);
  if (r.from && r.to && r.from > r.to) throw AppError.badRequest('"from" must not be after "to".');
  return r;
}
const rangeFilter = (r) => (r.from || r.to ? { ...(r.from ? { $gte: r.from } : {}), ...(r.to ? { $lte: r.to } : {}) } : null);
const dayKey = (d) => d.toISOString().slice(0, 10);
const startOfDayUtc = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const mondayOf = (d) => {
  const s = startOfDayUtc(d);
  return new Date(s.getTime() - ((s.getUTCDay() + 6) % 7) * DAY);
};
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null); // percent with 1 decimal, null when undefined

async function statusCounts(match) {
  const rows = await Inspection.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(STATUS_LIST.map((s) => [s, 0]));
  rows.forEach((r) => {
    byStatus[r._id] = r.n;
  });
  return { byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
}

/** Dashboard cards: always all-time, scoped to what the caller may see. */
async function dashboard(user) {
  const match = scopeFilter(user);
  const { byStatus, total } = await statusCounts(match);
  const ids = await Inspection.find(match).distinct('_id');
  const openReviews = await Review.countDocuments({ inspection: { $in: ids }, status: 'open' });
  return {
    total,
    reinspectionRequired: byStatus[STATUS.REINSPECT],
    awaitingHumanReview: byStatus[STATUS.REVIEW],
    defectConfirmed: byStatus[STATUS.DEFECT],
    passed: byStatus[STATUS.PASSED],
    openReviews,
  };
}

async function summary(user, query) {
  const range = parseRange(query);
  const created = rangeFilter(range);
  const match = { ...scopeFilter(user), ...(created ? { createdAt: created } : {}) };
  const settings = await getSettings();

  const { byStatus, total } = await statusCounts(match);
  const ids = await Inspection.find(match).distinct('_id');
  const allIds = created ? await Inspection.find(scopeFilter(user)).distinct('_id') : ids;

  const reinspected = await Inspection.countDocuments({ ...match, attemptCount: { $gt: 1 } });

  // volume per day
  const dayRows = await Inspection.aggregate([
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, n: { $sum: 1 } } },
  ]);
  const dayMap = new Map(dayRows.map((r) => [r._id, r.n]));
  const end = startOfDayUtc(range.to || new Date());
  let start = range.from ? startOfDayUtc(range.from) : dayRows.length ? new Date(dayRows.map((r) => r._id).sort()[0] + 'T00:00:00Z') : new Date(end.getTime() - 29 * DAY);
  if (end.getTime() - start.getTime() > 91 * DAY) start = new Date(end.getTime() - 91 * DAY); // keep the chart readable
  const volumeByDay = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) volumeByDay.push({ date: dayKey(new Date(t)), count: dayMap.get(dayKey(new Date(t))) || 0 });

  // evidence-quality issues (attempts whose metric is below the current minimum)
  const issueGroup = { _id: null, attempts: { $sum: 1 } };
  QUALITY_METRICS.forEach((m) => {
    issueGroup[m] = { $sum: { $cond: [{ $and: [{ $ne: [`$quality.${m}`, null] }, { $lt: [`$quality.${m}`, settings.minQualityScore] }] }, 1, 0] } };
  });
  const [issues = {}] = await Attempt.aggregate([{ $match: { inspection: { $in: ids }, assessmentStatus: 'assessed' } }, { $group: issueGroup }]);
  const failedAssessments = await Attempt.countDocuments({ inspection: { $in: ids }, assessmentStatus: 'failed' });

  // recaptures per week
  const recapRows = await Attempt.aggregate([
    { $match: { inspection: { $in: ids }, number: { $gt: 1 } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, n: { $sum: 1 } } },
  ]);
  const weekEnd = mondayOf(range.to || new Date());
  let weekStart = range.from ? mondayOf(range.from) : new Date(weekEnd.getTime() - 3 * 7 * DAY);
  if (weekEnd.getTime() - weekStart.getTime() > 11 * 7 * DAY) weekStart = new Date(weekEnd.getTime() - 11 * 7 * DAY);
  const weekMap = new Map();
  for (let t = weekStart.getTime(); t <= weekEnd.getTime(); t += 7 * DAY) weekMap.set(dayKey(new Date(t)), 0);
  recapRows.forEach((r) => {
    const k = dayKey(mondayOf(new Date(r._id + 'T00:00:00Z')));
    if (weekMap.has(k)) weekMap.set(k, weekMap.get(k) + r.n);
  });
  const recapturesByWeek = [...weekMap].map(([weekStartDate, count]) => ({ weekStart: weekStartDate, count }));

  // review workload
  const decidedFilter = { inspection: { $in: allIds }, status: 'decided', ...(created ? { 'decision.decidedAt': created } : {}) };
  const [openReviews, openedInRange, decidedRows, byReviewerRows] = await Promise.all([
    Review.countDocuments({ inspection: { $in: allIds }, status: 'open' }),
    Review.countDocuments({ inspection: { $in: allIds }, ...(created ? { createdAt: created } : {}) }),
    Review.aggregate([
      { $match: decidedFilter },
      { $group: { _id: '$decision.action', n: { $sum: 1 }, avgMs: { $avg: { $subtract: ['$decision.decidedAt', '$createdAt'] } } } },
    ]),
    Review.aggregate([{ $match: decidedFilter }, { $group: { _id: '$decision.reviewer', n: { $sum: 1 } } }]),
  ]);
  const names = new Map((await User.find({ _id: { $in: byReviewerRows.map((r) => r._id).filter(Boolean) } }).select('name')).map((u) => [String(u._id), u.name]));
  const decidedInRange = decidedRows.reduce((a, r) => a + r.n, 0);
  const avgMs = decidedInRange ? decidedRows.reduce((a, r) => a + r.avgMs * r.n, 0) / decidedInRange : null;

  const passed = byStatus[STATUS.PASSED];
  const defect = byStatus[STATUS.DEFECT];
  return {
    range: { from: range.from || null, to: range.to || null },
    totals: {
      total,
      passed,
      defectConfirmed: defect,
      reinspectionRequired: byStatus[STATUS.REINSPECT],
      awaitingHumanReview: byStatus[STATUS.REVIEW],
    },
    rates: {
      // % of finalised decisions (Passed + Defect Confirmed) that were Passed; null when nothing is finalised yet.
      passRate: ratio(passed, passed + defect),
      defectConfirmationRate: ratio(defect, passed + defect),
      // % of inspections that needed at least one recapture.
      reinspectionRate: ratio(reinspected, total),
      inspectionsWithRecapture: reinspected,
    },
    evidenceIssues: {
      minQualityScore: settings.minQualityScore,
      attemptsAssessed: issues.attempts || 0,
      failedAssessments,
      counts: Object.fromEntries(QUALITY_METRICS.map((m) => [m, issues[m] || 0])),
    },
    volumeByDay,
    recapturesByWeek,
    reviewWorkload: {
      open: openReviews,
      openedInRange,
      decidedInRange,
      avgDecisionHours: avgMs == null ? null : Math.round((avgMs / 3600000) * 10) / 10,
      byDecision: Object.fromEntries(decidedRows.map((r) => [r._id, r.n])),
      byReviewer: byReviewerRows.map((r) => ({ reviewerId: r._id ? String(r._id) : null, name: names.get(String(r._id)) || 'Unknown', decided: r.n })),
    },
  };
}

module.exports = { dashboard, summary, parseRange };
