const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { logger } = require('../logger');
const { inc } = require('../metrics');

function createApp({ apiKey } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use(
    '/api/import',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 5,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const requestId = crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      inc('http_requests', 1);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      if (res.statusCode >= 500) inc('http_errors', 1);
      logger.info('http_request', {
        request_id: requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(elapsedMs),
      });
    });
    next();
  });

  const safeEquals = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  };

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (!apiKey) return res.status(503).json({ error: 'API disabled' });
    const provided = req.header('x-api-key');
    if (!provided || !safeEquals(provided, apiKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  return app;
}

module.exports = { createApp };
