const { pool } = require('./pool');
const { ensureSchema } = require('./schema');

async function logAudit(accountId, userId, action, entityType = null, entityId = null, detail = null) {
  await ensureSchema();
  const detailJson = detail ? JSON.stringify(detail) : null;
  await pool.execute(
    `INSERT INTO audit_logs (account_id, user_id, action, entity_type, entity_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [accountId, userId, action, entityType, entityId, detailJson],
  );
}

module.exports = { logAudit };
