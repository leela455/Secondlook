'use strict';
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, writeLimiter } = require('../middleware/rateLimiters');
const { uploadImage } = require('../middleware/upload');
const { asyncHandler } = require('../utils/helpers');
const { ROLES } = require('../utils/constants');
const v = require('../validators/schemas');

const auth = require('../controllers/authController');
const users = require('../controllers/usersController');
const insp = require('../controllers/inspectionsController');
const reviews = require('../controllers/reviewsController');
const misc = require('../controllers/miscController');

const { ADMIN, INSPECTOR, REVIEWER } = ROLES;
const h = asyncHandler;
const router = express.Router();

// ---- auth -----------------------------------------------------------------------------------------------------
router.post('/auth/register', authLimiter, validate({ body: v.auth.register }), h(auth.register));
router.post('/auth/login', authLimiter, validate({ body: v.auth.login }), h(auth.login));
router.post('/auth/logout', authenticate, h(auth.logout));
router.get('/auth/me', authenticate, auth.me);

// Everything below requires a valid token.
router.use(authenticate);

// ---- users (admin) --------------------------------------------------------------------------------------------
router.get('/users', authorize(ADMIN), validate({ query: v.users.list }), h(users.list));
router.patch('/users/:id', authorize(ADMIN), validate({ params: v.users.idParam, body: v.users.update }), h(users.update));

// ---- inspections ----------------------------------------------------------------------------------------------
router.post('/inspections', authorize(INSPECTOR, ADMIN), writeLimiter, ...uploadImage, validate({ body: v.inspections.create }), h(insp.create));
router.get('/inspections', validate({ query: v.inspections.list }), h(insp.list));
router.get('/inspections/:id', validate({ params: v.inspections.idParam }), h(insp.get));
router.patch('/inspections/:id', validate({ params: v.inspections.idParam, body: v.inspections.update }), h(insp.update));
router.delete('/inspections/:id', authorize(ADMIN), validate({ params: v.inspections.idParam }), h(insp.remove));

router.get('/inspections/:id/evidence', validate({ params: v.inspections.idParam }), h(insp.evidenceForInspection));
router.get('/inspections/:id/evidence/:attempt/image', validate({ params: v.inspections.attemptParam }), h(insp.evidenceImage));
router.post('/inspections/:id/recapture', authorize(INSPECTOR, ADMIN), writeLimiter, ...uploadImage, validate({ params: v.inspections.idParam }), h(insp.recapture));
router.get('/inspections/:id/decision', validate({ params: v.inspections.idParam }), h(insp.decisionHistory));
router.post('/inspections/:id/decision', authorize(INSPECTOR, ADMIN), writeLimiter, validate({ params: v.inspections.idParam, body: v.inspections.decision }), h(insp.decide));

router.get('/evidence', validate({ query: v.inspections.evidenceList }), h(insp.evidenceHistory));

// ---- human review ---------------------------------------------------------------------------------------------
router.get('/reviews', authorize(REVIEWER, ADMIN), validate({ query: v.reviews.list }), h(reviews.list));
router.get('/reviews/:id', authorize(REVIEWER, ADMIN), validate({ params: v.reviews.idParam }), h(reviews.get));
router.post('/reviews/:id/decision', authorize(REVIEWER, ADMIN), writeLimiter, validate({ params: v.reviews.idParam, body: v.reviews.decide }), h(reviews.decide));

// ---- analytics ------------------------------------------------------------------------------------------------
router.get('/analytics/dashboard', h(misc.dashboard));
router.get('/analytics/summary', validate({ query: v.analytics.range }), h(misc.summary));

// ---- settings -------------------------------------------------------------------------------------------------
router.get('/settings', h(misc.getSettings));
router.get('/model/categories', h(misc.modelCategories));
router.put('/settings/app', authorize(ADMIN), validate({ body: v.settings.app }), h(misc.updateApp));
router.patch('/settings/me', validate({ body: v.settings.me }), h(misc.updateMe));

module.exports = router;
