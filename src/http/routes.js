const { spawn } = require('child_process');
const { pool } = require('../db/pool');
const { logger } = require('../logger');
const { metrics, inc, setGauge } = require('../metrics');
const { checkSchema } = require('../db/schemaCheck');
const { apiRouter } = require('./api');

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

  app.use('/api', apiRouter);

  app.get('/debug/config', (req, res) => {
    logger.info('debug_config', { hasApiKey: !!process.env.HTTP_API_KEY });
    res.json({ ok: true, hasApiKey: !!process.env.HTTP_API_KEY });
  });
}

module.exports = { registerRoutes };
