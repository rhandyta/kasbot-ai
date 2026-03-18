function registerRoutes(app) {
  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });
}

module.exports = { registerRoutes };
