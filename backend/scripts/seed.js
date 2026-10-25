'use strict';
// Loads clearly-labelled SAMPLE data (the same seven components as the original demo).
//   npm run seed            -> only seeds an empty database
//   npm run seed -- --reset -> wipes all SecondLook collections first, then seeds
//
// Sample attempts have no image file, are tagged source.kind="seed" and are shown as "Sample data" in the UI.
// Statuses are produced by the real decision rules (services/decisionService.js), not hard-coded.
const { env } = require('../config/env');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Inspection = require('../models/Inspection');
const Attempt = require('../models/Attempt');
const Review = require('../models/Review');
const AuditLog = require('../models/AuditLog');
const { Counter, codeToSeq } = require('../models/Counter');
const { Setting } = require('../models/Setting');
const { decide } = require('../services/decisionService');
const { getSettings } = require('../services/settingsService');
const { STATUS } = require('../utils/constants');

const DEMO_PASSWORD = 'Demo#12345';
const USERS = [
  { name: 'Demo Admin', email: 'admin@secondlook.local', role: 'admin' },
  { name: 'Demo Inspector', email: 'inspector@secondlook.local', role: 'inspector' },
  { name: 'Demo Reviewer', email: 'reviewer@secondlook.local', role: 'reviewer' },
];

const DAY = 86400000;
const SPECS = [
  { n: 1036, name: 'Bracket K19', daysAgo: 9, attempts: [{ q: [40, 55, 45, 52], conf: 58, det: false }, { q: [62, 70, 60, 64], conf: 58, det: false }] },
  { n: 1037, name: 'Flange F450', daysAgo: 8, attempts: [{ q: [90, 88, 92, 96], conf: 94, det: false }] },
  { n: 1038, name: 'Valve Body V12', daysAgo: 6, attempts: [{ q: [49, 76, 62, 70], conf: 72, det: false }] },
  { n: 1039, name: 'Gear Hub G310', daysAgo: 5, attempts: [{ q: [58, 44, 80, 85], conf: 67, det: true }, { q: [80, 62, 85, 88], conf: 67, det: true }] },
  { n: 1040, name: 'Bearing Plate C07', daysAgo: 3, attempts: [{ q: [85, 82, 90, 91], conf: 88, det: true }] },
  { n: 1041, name: 'Shaft Coupling B22', daysAgo: 2, attempts: [{ q: [92, 90, 94, 95], conf: 96, det: false }] },
  { n: 1042, name: 'Metal Housing A104', daysAgo: 1, attempts: [{ q: [34, 41, 70, 78], conf: 61, det: true }] },
];

async function run() {
  if (env.isProd) throw new Error('Refusing to seed demo accounts with known passwords when NODE_ENV=production.');
  await connectDB();
  const reset = process.argv.includes('--reset');
  if (reset) {
    await Promise.all([User, Inspection, Attempt, Review, AuditLog, Counter, Setting].map((m) => m.deleteMany({})));
    console.log('All SecondLook collections were cleared (--reset).');
  } else if ((await Inspection.countDocuments()) > 0) {
    console.log('The database already contains inspections. Nothing seeded. Use "npm run seed -- --reset" to start over.');
    return;
  }

  const settings = await getSettings();
  const users = {};
  for (const u of USERS) {
    users[u.role] =
      (await User.findOne({ email: u.email })) || (await User.create({ ...u, password: await User.hashPassword(DEMO_PASSWORD) }));
  }
  const inspector = users.inspector;

  for (const spec of SPECS) {
    const code = `SL-${spec.n}`;
    const t0 = Date.now() - spec.daysAgo * DAY;
    const insp = new Inspection({
      code,
      componentName: spec.name,
      inspectionType: 'Surface defect',
      status: STATUS.REINSPECT,
      inspector: inspector._id,
      notes: 'SAMPLE DATA created by the seed script.',
      createdAt: new Date(t0),
    });
    await insp.save();
    await AuditLog.create({ inspection: insp._id, actor: inspector._id, actorName: inspector.name, action: 'inspection_created', reason: 'Sample data (seed script)', createdAt: new Date(t0) });

    let outcome;
    let last;
    for (let i = 0; i < spec.attempts.length; i++) {
      const a = spec.attempts[i];
      const when = new Date(t0 + i * 3600000);
      const raw = {
        number: i + 1,
        assessmentStatus: 'assessed',
        quality: { sharpness: a.q[0], lighting: a.q[1], alignment: a.q[2], visibility: a.q[3] },
        defect: { detected: a.det, confidence: a.conf, label: a.det ? 'surface defect (sample)' : 'no defect (sample)' },
      };
      outcome = decide(raw, settings);
      last = await Attempt.create({
        ...raw,
        inspection: insp._id,
        uploadedBy: inspector._id,
        evidence: outcome.evidence,
        source: { kind: 'seed', provider: 'seed', modelVersion: 'sample-data', demo: true },
        evaluated: true,
        outcome: outcome.status,
        outcomeRule: outcome.rule,
        evaluatedAt: when,
        thresholds: { confidenceThreshold: settings.confidenceThreshold, minQualityScore: settings.minQualityScore },
        createdAt: when,
      });
      await AuditLog.create({
        inspection: insp._id,
        actor: null,
        actorName: 'System (automated rule)',
        action: i === 0 ? 'decision' : 'second_look',
        to: outcome.status,
        rule: outcome.rule,
        reason: outcome.reason,
        attemptNumber: i + 1,
        createdAt: new Date(when.getTime() + 1000),
      });
    }

    insp.status = outcome.status;
    insp.attemptCount = spec.attempts.length;
    insp.reviewOpen = !!outcome.reviewType;
    insp.lastDecision = { rule: outcome.rule, reason: outcome.reason, recommendations: outcome.recommendations, automated: true, at: last.evaluatedAt };
    insp.latest = {
      attemptId: last._id,
      attemptNumber: last.number,
      confidence: last.defect.confidence,
      quality: { sharpness: last.quality.sharpness, lighting: last.quality.lighting, alignment: last.quality.alignment, visibility: last.quality.visibility },
      evidenceLabel: last.evidence.label,
      assessmentStatus: 'assessed',
      sourceKind: 'seed',
      evaluated: true,
      hasImage: false,
    };
    await insp.save();
    if (outcome.reviewType) {
      await Review.create({ inspection: insp._id, attempt: last._id, type: outcome.reviewType, reason: outcome.reason, automated: true, createdAt: last.evaluatedAt });
    }
  }

  // Next generated ID continues after the last sample (SL-1043).
  await Counter.updateOne({ _id: 'inspection' }, { $set: { seq: codeToSeq('SL-1042') } }, { upsert: true });

  console.log('\nSample data loaded: 7 inspections.\n');
  console.log('Demo accounts (password for all: ' + DEMO_PASSWORD + ')');
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(9)} ${u.email}`));
  console.log('\nThese accounts are for local demos only. Do not use them in production.\n');
}

run()
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await disconnectDB();
  });
