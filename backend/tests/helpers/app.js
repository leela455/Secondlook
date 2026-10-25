// Shared helpers for integration tests (real HTTP stack + real MongoDB).
//
// Database: set TEST_MONGODB_URI (e.g. mongodb://127.0.0.1:27017) to use a MongoDB you already run, or leave it
// unset and mongodb-memory-server downloads and starts a throw-away mongod on first run.
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { env } = require('../../config/env');
const { connectDB, disconnectDB } = require('../../config/db');
const { createApp } = require('../../app');
const inspectionService = require('../../services/inspectionService');
const User = require('../../models/User');

let mongod;
const dbName = `secondlook_test_${process.pid}_${Date.now()}`;

async function startDb() {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }
  await connectDB(uri, { dbName });
}

async function stopDb() {
  if (process.env.TEST_MONGODB_URI) await mongoose.connection.dropDatabase();
  await disconnectDB();
  if (mongod) await mongod.stop();
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
}

async function clearDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  // uploaded evidence files belong to the records we just deleted
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

// ---- fake model -------------------------------------------------------------------------------------------------
const Q = (sharpness, lighting, alignment, visibility) => ({ sharpness, lighting, alignment, visibility });
const GOOD = Q(90, 90, 90, 90);
const BAD = Q(30, 40, 70, 78);
const R = (quality, confidence, detected = false) => ({ modelVersion: 'stub-1', quality, defect: { detected, confidence } });

/** Queue model results (an Error instance makes the "model" fail). Falls back to a confident pass. */
function useModel(...results) {
  const queue = [...results];
  inspectionService.setProvider({
    name: 'stub',
    kind: 'model',
    assess: async () => {
      const next = queue.length ? queue.shift() : R(GOOD, 95, false);
      if (next instanceof Error) throw next;
      return next;
    },
  });
}
const resetModel = () => inspectionService.setProvider(null);

// ---- fixtures ---------------------------------------------------------------------------------------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (size = 64) => Buffer.concat([PNG_SIG, crypto.randomBytes(size)]);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), crypto.randomBytes(32)]);

// ---- api helpers ------------------------------------------------------------------------------------------------
function makeApi() {
  const app = createApp();
  const auth = (req, token) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  const api = {
    app,
    get: (url, token) => auth(request(app).get(`/api/v1${url}`), token),
    post: (url, token, body) => auth(request(app).post(`/api/v1${url}`), token).send(body),
    patch: (url, token, body) => auth(request(app).patch(`/api/v1${url}`), token).send(body),
    put: (url, token, body) => auth(request(app).put(`/api/v1${url}`), token).send(body),
    del: (url, token) => auth(request(app).delete(`/api/v1${url}`), token),
    raw: () => request(app),
    /** multipart POST with an image */
    upload(url, token, fields = {}, file = { buffer: png(), filename: 'part.png', contentType: 'image/png' }) {
      let r = auth(request(app).post(`/api/v1${url}`), token);
      Object.entries(fields).forEach(([k, v]) => (r = r.field(k, v)));
      if (file) r = r.attach('image', file.buffer, { filename: file.filename, contentType: file.contentType });
      return r;
    },
    newInspection(token, name = 'Test Part', extra = {}) {
      return api.upload('/inspections', token, { componentName: name, inspectionType: 'Surface defect', ...extra });
    },
  };
  return api;
}

/** Registers admin (first user), inspector, inspector2, reviewer. Returns tokens + ids. */
async function createUsers(api) {
  const pw = 'Passw0rd!x';
  const reg = async (name, email) => (await api.post('/auth/register', null, { name, email, password: pw })).body.data;
  const admin = await reg('Ada Admin', 'admin@test.io');
  const inspector = await reg('Ivy Inspector', 'ivy@test.io');
  const inspector2 = await reg('Ian Inspector', 'ian@test.io');
  const reviewer = await reg('Rae Reviewer', 'rae@test.io');
  await User.updateOne({ email: 'rae@test.io' }, { $set: { role: 'reviewer' } }); // role changes happen via admin/DB, never at sign-up
  return {
    pw,
    admin: { token: admin.token, id: admin.user.id },
    inspector: { token: inspector.token, id: inspector.user.id },
    inspector2: { token: inspector2.token, id: inspector2.user.id },
    reviewer: { token: reviewer.token, id: reviewer.user.id },
  };
}

module.exports = { startDb, stopDb, clearDb, useModel, resetModel, R, Q, GOOD, BAD, png, jpg, webp, makeApi, createUsers, env };
