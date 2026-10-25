'use strict';
const User = require('../models/User');
const { ok } = require('../utils/respond');
const analytics = require('../services/analyticsService');
const settingsService = require('../services/settingsService');
const { describeProvider, listModelCategories } = require('../services/inspectionService');
const { DEFAULTS } = require('../models/Setting');
const { logAudit } = require('../services/auditService');
const { isDbReady } = require('../config/db');

const dashboard = async (req, res) => ok(res, await analytics.dashboard(req.user));
const summary = async (req, res) => ok(res, await analytics.summary(req.user, req.valid.query));

async function getSettings(req, res) {
  const app = await settingsService.getSettings();
  ok(res, { app, defaults: DEFAULTS, provider: describeProvider(), me: req.user });
}

async function updateApp(req, res) {
  const app = await settingsService.updateSettings(req.body, req.user);
  await logAudit({ actor: req.user, action: 'settings_updated', meta: { changes: req.body } });
  ok(res, { app, provider: describeProvider() });
}

async function updateMe(req, res) {
  const user = await User.findById(req.user._id);
  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.preferences && req.body.preferences.theme) user.preferences.theme = req.body.preferences.theme;
  await user.save();
  ok(res, { me: user });
}

async function modelCategories(_req, res) {
  ok(res, await listModelCategories());
}

const health = (_req, res) => res.status(isDbReady() ? 200 : 503).json({ success: isDbReady(), data: { status: isDbReady() ? 'ok' : 'degraded', database: isDbReady() ? 'connected' : 'unavailable' } });

module.exports = { dashboard, summary, getSettings, updateApp, updateMe, modelCategories, health };
