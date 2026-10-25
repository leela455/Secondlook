'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { env } = require('./config/env');
const routes = require('./routes');
const misc = require('./controllers/miscController');
const { apiLimiter } = require('./middleware/rateLimiters');
const { notFound, errorHandler, requireDb } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // The current frontend uses inline <script> and onclick="" handlers, so the CSP has to allow 'unsafe-inline'
  // for scripts. Everything else is locked to this origin. (See README "Security notes".)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...env.clientOrigins],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.clientOrigins.includes(origin)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    })
  );

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev')); // request line only: bodies/tokens are never logged
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', misc.health);
  app.use('/api/v1', apiLimiter, requireDb, routes);

  if (env.serveFrontend && fs.existsSync(path.join(env.frontendDir, 'index.html'))) {
    app.use(express.static(env.frontendDir, { index: 'index.html', maxAge: 0 }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
