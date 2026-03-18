const express = require('express');
const { listAuditLogs } = require('../../db');
const { requiredInt, optionalInt, optionalDate } = require('./utils');

const router = express.Router();

router.get('/', async (req, res) => {
  const accountId = requiredInt(req.query.accountId, 'accountId');
  const startDate = req.query.start ? optionalDate(req.query.start) : null;
  const endDate = req.query.end ? optionalDate(req.query.end) : null;
  const action = req.query.action ? String(req.query.action) : null;
  const limit = optionalInt(req.query.limit, 50);
  const offset = optionalInt(req.query.offset, 0);
  const data = await listAuditLogs(accountId, { startDate, endDate, action, limit, offset });
  res.json({ ok: true, data });
});

module.exports = { auditRouter: router };

