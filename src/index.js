const { createApp } = require('./http/app');
const { registerRoutes } = require('./http/routes');
const { startBot } = require('./bot');

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
