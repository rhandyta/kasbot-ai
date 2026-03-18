const express = require('express');
const { dashboardRouter } = require('./dashboard');
const { transactionsRouter } = require('./transactions');
const { auditRouter } = require('./audit');
const { importRouter } = require('./import');

const router = express.Router();

router.use('/dashboard', dashboardRouter);
router.use('/transactions', transactionsRouter);
router.use('/audit', auditRouter);
router.use('/import', importRouter);

router.use((err, req, res, next) => {
  const status = err?.status || 500;
  res.status(status).json({ ok: false, error: err?.message || 'error' });
});

module.exports = { apiRouter: router };
