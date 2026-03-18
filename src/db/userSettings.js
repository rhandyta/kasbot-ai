const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { logAudit } = require('./audit');
const { ensureUserSettingsRow, getActiveAccountContext } = require('./accounts');

async function getUserCurrency(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const sql = `SELECT currency FROM user_settings WHERE user_id = ?`;
  const [rows] = await pool.execute(sql, [userId]);
  if (rows.length === 0) return 'IDR';
  return rows[0].currency;
}

async function setUserCurrency(userId, currency) {
  await ensureSchema();
  const sql = `
    INSERT INTO user_settings (user_id, currency)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE currency = ?, updated_at = CURRENT_TIMESTAMP
  `;
  await pool.execute(sql, [userId, currency, currency]);
  const { accountId } = await getActiveAccountContext(userId);
  await logAudit(accountId, userId, 'currency_set', 'user_settings', userId, { currency });
}

module.exports = { getUserCurrency, setUserCurrency };
