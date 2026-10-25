'use strict';
// Central place where every environment variable is read and validated.
require('dotenv').config({ quiet: true });
const path = require('path');

const num = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 5000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secondlook',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  // Browser origins allowed to call the API (only needed when the frontend is served from another port).
  clientOrigins: (
    process.env.CLIENT_ORIGINS ||
    'http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:5500,http://127.0.0.1:5500'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
  frontendDir: path.resolve(__dirname, '..', '..', 'frontend'),
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  authRateLimitMax: num(process.env.AUTH_RATE_LIMIT_MAX, 20), // per 15 minutes per IP
  apiRateLimitMax: num(process.env.API_RATE_LIMIT_MAX, 600), // per minute per IP
  // Inspection provider: "demo" (mock, clearly labelled) or "http" (your real model service).
    // Inspection provider: "demo" (mock, clearly labelled) or "http" (configured service; inspect its capabilities).
  inspectionProvider: (process.env.INSPECTION_PROVIDER || 'demo').toLowerCase(),
  modelApiUrl: process.env.MODEL_API_URL || '',
  modelApiKey: process.env.MODEL_API_KEY || '',
  modelApiTimeoutMs: num(process.env.MODEL_API_TIMEOUT_MS, 15000),
};

env.isProd = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

function validateEnv() {
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    problems.push(
      'JWT_SECRET is missing or shorter than 32 characters. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  if (!['demo', 'http'].includes(env.inspectionProvider)) {
    problems.push('INSPECTION_PROVIDER must be "demo" or "http".');
  }
  if (env.inspectionProvider === 'http' && !env.modelApiUrl) {
    problems.push('INSPECTION_PROVIDER=http requires MODEL_API_URL.');
  }
  if (problems.length) {
    const err = new Error('Invalid configuration:\n - ' + problems.join('\n - '));
    err.code = 'INVALID_ENV';
    throw err;
  }
}

module.exports = { env, validateEnv };
