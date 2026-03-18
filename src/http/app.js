const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logger } = require('../logger');

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

  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('http_request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(elapsedMs),
      });
    });
    next();
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (!apiKey) return res.status(503).json({ error: 'API disabled' });
    const provided = req.header('x-api-key');
    if (!provided || provided !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  return app;
}

module.exports = { createApp };
