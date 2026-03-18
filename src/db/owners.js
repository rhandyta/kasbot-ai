const { pool } = require('./pool');
const { ensureSchema } = require('./schema');

async function getAccountMemberRole(accountId, userId) {
  const [rows] = await pool.execute(
    `SELECT role, can_write FROM account_members WHERE account_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`,
    [accountId, userId],
  );
  if (rows.length === 0) return null;
  return { role: rows[0].role, canWrite: !!rows[0].can_write };
}

async function assertOwner(accountId, userId) {
  await ensureSchema();
  const member = await getAccountMemberRole(accountId, userId);
  if (!member || member.role !== 'owner') {
    throw new Error('Khusus owner.');
  }
}

module.exports = { assertOwner };
