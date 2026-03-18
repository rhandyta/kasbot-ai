const { spawn } = require('child_process');
const { pool } = require('../db/pool');
const { logger } = require('../logger');
const { parseStatementCsv } = require('../import/csv');
const { insertTransaction, ensureSchema, findTransactionByFingerprint } = require('../db');
const { metrics, inc, setGauge } = require('../metrics');
const { checkSchema } = require('../db/schemaCheck');
const { logAudit } = require('../db/audit');

let lastPythonCheck = { at: 0, ok: null, error: null };

async function checkDb() {
  try {
    await pool.execute('SELECT 1');
    return { ok: true };
  } catch (e) {
    inc('db_errors', 1);
    return { ok: false, error: e?.message || 'db_error' };
  }
}

async function checkPythonEasyOcrCached() {
  const now = Date.now();
  if (now - lastPythonCheck.at < 5 * 60 * 1000 && lastPythonCheck.ok !== null) {
    return { ok: lastPythonCheck.ok, cached: true, error: lastPythonCheck.error };
  }

  const result = await new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const child = spawn(pythonBin, ['-c', 'import easyocr; print(1)'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ ok: false, error: 'timeout' });
    }, 2500);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      setGauge('last_ocr_ms', Math.round(elapsedMs));
      if (code === 0 && stdout.trim() === '1') {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: (stderr || stdout || `exit_${code}`).trim() });
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e?.message || 'spawn_error' });
    });
  });

  lastPythonCheck = { at: now, ok: result.ok, error: result.error || null };
  return { ...result, cached: false };
}

function registerRoutes(app) {
  app.get('/health', async (req, res) => {
    const [db, python, schema] = await Promise.all([checkDb(), checkPythonEasyOcrCached(), checkSchema()]);
    const ok = db.ok && python.ok && schema.ok;
    res.status(ok ? 200 : 503).json({ ok, db, python, schema });
  });

  app.get('/metrics', (req, res) => {
    res.json({ ok: true, metrics });
  });

  app.post('/api/import/statement', async (req, res) => {
    try {
      await ensureSchema();
      const { accountId, csv, dryRun } = req.body || {};
      const account = parseInt(accountId, 10);
      if (!Number.isFinite(account) || account <= 0) {
        return res.status(400).json({ ok: false, error: 'accountId invalid' });
      }
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
          const dup = await findTransactionByFingerprint(account, tx.fingerprint_hash);
          if (dup) {
            skipped += 1;
            continue;
          }
        }
        await insertTransaction(account, tx, null);
        inserted += 1;
      }
      await logAudit(account, null, 'api_import_statement', 'account', String(account), {
        request_id: req.requestId || null,
        inserted,
        skipped,
      });
      return res.json({ ok: true, inserted, skipped });
    } catch (e) {
      logger.error('import_statement_failed', { error: e?.message || String(e) });
      return res.status(400).json({ ok: false, error: e?.message || 'import_failed' });
    }
  });

  app.get('/debug/config', (req, res) => {
    logger.info('debug_config', { hasApiKey: !!process.env.HTTP_API_KEY });
    res.json({ ok: true, hasApiKey: !!process.env.HTTP_API_KEY });
  });
}

module.exports = { registerRoutes };
