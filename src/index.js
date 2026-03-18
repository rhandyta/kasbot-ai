const { createApp } = require('./http/app');
const { registerRoutes } = require('./http/routes');
const { startBot } = require('./bot');
const { runDueRecurringAll, ensureSchema } = require('./db');

function startHttpServer() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const apiKey = process.env.HTTP_API_KEY || null;

  const app = createApp({ apiKey });
  registerRoutes(app);

  const server = app.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  return server;
}

startHttpServer();
startBot();

ensureSchema().then(() => {
  runDueRecurringAll().catch((e) => console.error('Recurring runner error:', e));
  setInterval(() => {
    runDueRecurringAll().catch((e) => console.error('Recurring runner error:', e));
  }, 5 * 60 * 1000);
});
