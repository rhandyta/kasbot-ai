const express = require('express');
const {
  getSummary,
  getTimeSeries,
  getBreakdownByCategory,
  getBreakdownByMerchant,
  getBudgetStatus,
  yyyymm,
} = require('../../db');
const { requiredInt, optionalInt, optionalDate, optionalMonth, optionalCurrency } = require('./utils');

const router = express.Router();

router.get('/summary', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const startDate = optionalDate(req.query.start) || optionalDate(req.query.startDate);
  const endDate = optionalDate(req.query.end) || optionalDate(req.query.endDate);
  if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'start/end required' });
  const currency = optionalCurrency(req.query.currency, 'IDR');
  const data = await getSummary(accountId, startDate, endDate, currency);
  res.json({ ok: true, data });
});

router.get('/timeseries', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const startDate = optionalDate(req.query.start) || optionalDate(req.query.startDate);
  const endDate = optionalDate(req.query.end) || optionalDate(req.query.endDate);
  if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'start/end required' });
  const currency = optionalCurrency(req.query.currency, 'IDR');
  const bucket = String(req.query.bucket || 'day');
  const data = await getTimeSeries(accountId, startDate, endDate, bucket, currency);
  res.json({ ok: true, data });
});

router.get('/by-category', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const startDate = optionalDate(req.query.start) || optionalDate(req.query.startDate);
  const endDate = optionalDate(req.query.end) || optionalDate(req.query.endDate);
  if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'start/end required' });
  const currency = optionalCurrency(req.query.currency, 'IDR');
  const type = req.query.type ? String(req.query.type) : null;
  const limit = optionalInt(req.query.limit, 20);
  const data = await getBreakdownByCategory(accountId, startDate, endDate, type, currency, limit);
  res.json({ ok: true, data });
});

router.get('/by-merchant', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const startDate = optionalDate(req.query.start) || optionalDate(req.query.startDate);
  const endDate = optionalDate(req.query.end) || optionalDate(req.query.endDate);
  if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'start/end required' });
  const currency = optionalCurrency(req.query.currency, 'IDR');
  const type = req.query.type ? String(req.query.type) : null;
  const limit = optionalInt(req.query.limit, 20);
  const data = await getBreakdownByMerchant(accountId, startDate, endDate, type, currency, limit);
  res.json({ ok: true, data });
});

router.get('/budget-status', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const month = optionalMonth(req.query.month) || yyyymm(optionalDate(req.query.start));
  if (!month) return res.status(400).json({ ok: false, error: 'month required' });
  const currency = optionalCurrency(req.query.currency, 'IDR');
  const data = await getBudgetStatus(accountId, month, currency);
  res.json({ ok: true, data });
});

module.exports = { dashboardRouter: router };

