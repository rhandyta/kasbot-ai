const { spawn } = require('child_process');
const { pool } = require('../db/pool');

let lastPythonCheck = { at: 0, ok: null, error: null };

async function checkDb() {
  try {
    await pool.execute('SELECT 1');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'db_error' };
  }
}

async function checkPythonEasyOcrCached() {
  const now = Date.now();
  if (now - lastPythonCheck.at < 5 * 60 * 1000 && lastPythonCheck.ok !== null) {
    return { ok: lastPythonCheck.ok, cached: true, error: lastPythonCheck.error };
  }

  const result = await new Promise((resolve) => {
    const child = spawn('python', ['-c', 'import easyocr; print(1)'], {
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
    const [db, python] = await Promise.all([checkDb(), checkPythonEasyOcrCached()]);
    const ok = db.ok && python.ok;
    res.status(ok ? 200 : 503).json({ ok, db, python });
  });
}

module.exports = { registerRoutes };
