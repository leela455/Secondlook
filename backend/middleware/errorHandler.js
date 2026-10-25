'use strict';
const multer = require('multer');
const { ZodError } = require('zod');
const mongoose = require('mongoose');
const { env } = require('../config/env');
const logger = require('../utils/logger');
const { removeFileQuietly } = require('../utils/helpers');
const { isDbReady } = require('../config/db');
const AppError = require('../utils/AppError');

const notFound = (req, _res, next) => next(AppError.notFound(`Route not found: ${req.method} ${req.path}`));

// Returns 503 instead of hanging when MongoDB is down.
const requireDb = (req, _res, next) => {
  if (isDbReady()) return next();
  next(new AppError(503, 'The database is currently unavailable. Please try again shortly.', 'DB_UNAVAILABLE'));
};

// eslint-disable-next-line no-unused-vars
async function errorHandler(err, req, res, _next) {
  // Never leave an orphaned upload behind when a request fails.
  if (req.file && req.file.path) await removeFileQuietly(req.file.path);

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid.';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid.';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_REQUEST';
    message = `Invalid value for "${err.path}".`;
  } else if (err && err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with these details already exists.';
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File is larger than ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB. Choose a smaller image.`
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field. Upload a single file named "image".'
          : 'Upload failed.';
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Request body is not valid JSON.';
  } else if (err && err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  } else if (err && (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError')) {
    status = 503;
    code = 'DB_UNAVAILABLE';
    message = 'The database is currently unavailable. Please try again shortly.';
  }

  if (status >= 500) logger.error(`${req.method} ${req.originalUrl} -> ${status}`, { error: err && err.stack ? err.stack : String(err) });
  else logger.debug(`${req.method} ${req.originalUrl} -> ${status} ${code}`);

  if (res.headersSent) return;
  // Stack traces and raw error text are never sent to clients.
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}

module.exports = { notFound, errorHandler, requireDb };
