const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/http/app');
const { registerRoutes } = require('../src/http/routes');
const { pool } = require('../src/db/pool');

test('GET /health returns JSON', async () => {
  const app = createApp({ apiKey: null });
  registerRoutes(app);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const json = await res.json();
  assert.equal(typeof json.ok, 'boolean');

  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});
