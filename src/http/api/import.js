const express = require('express');
const { parseStatementCsv } = require('../../import/csv');
const { insertTransaction, ensureSchema, findTransactionByFingerprint } = require('../../db');
const { logAudit } = require('../../db/audit');
const { requiredInt } = require('./utils');
const { logger } = require('../../logger');

const router = express.Router();

router.post('/statement', async (req, res) => {
  try {
    await ensureSchema();
    const accountId = requiredInt(req.body?.accountId, 'accountId');
    const csv = req.body?.csv;
    const dryRun = !!req.body?.dryRun;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ ok: false, error: 'csv required' });
    }
    const txs = parseStatementCsv(csv);
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, count: txs.length, sample: txs.slice(0, 3) });
    }

    let inserted = 0;
    let skipped = 0;
    for (const tx of txs) {
      if (tx.fingerprint_hash) {
        const dup = await findTransactionByFingerprint(accountId, tx.fingerprint_hash);
        if (dup) {
          skipped += 1;
          continue;
        }
      }
      await insertTransaction(accountId, tx, null);
      inserted += 1;
    }

    await logAudit(accountId, null, 'api_import_statement', 'account', String(accountId), {
      request_id: req.requestId || null,
      inserted,
      skipped,
    });
    return res.json({ ok: true, inserted, skipped });
  } catch (e) {
    logger.error('import_statement_failed', { error: e?.message || String(e) });
    return res.status(e?.status || 400).json({ ok: false, error: e?.message || 'import_failed' });
  }
});

module.exports = { importRouter: router };

