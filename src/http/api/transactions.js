const express = require('express');
const { listTransactions, getTransactionDetail } = require('../../db');
const { requiredInt, optionalInt, optionalBool, optionalDate, optionalCurrency } = require('./utils');

const router = express.Router();

router.get('/', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const startDate = req.query.start ? optionalDate(req.query.start) : null;
  const endDate = req.query.end ? optionalDate(req.query.end) : null;
  const type = req.query.type ? String(req.query.type) : null;
  const category = req.query.category ? String(req.query.category) : null;
  const merchant = req.query.merchant ? String(req.query.merchant) : null;
  const q = req.query.q ? String(req.query.q) : null;
  const limit = optionalInt(req.query.limit, 20);
  const offset = optionalInt(req.query.offset, 0);
  const includeItems = optionalBool(req.query.includeItems, false);
  const currency = req.query.currency ? optionalCurrency(req.query.currency, null) : null;

  const data = await listTransactions(
    accountId,
    { startDate, endDate, type, category, merchant, q, limit, offset, includeItems },
    currency,
  );
  res.json({ ok: true, data });
});

router.get('/:id', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const currency = req.query.currency ? optionalCurrency(req.query.currency, null) : null;
  const data = await getTransactionDetail(accountId, req.params.id, currency);
  if (!data) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, data });
});

module.exports = { transactionsRouter: router };

