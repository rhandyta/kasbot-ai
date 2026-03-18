const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { convertAmount } = require('./currency');
const { logAudit } = require('./audit');
const { assertOwner } = require('./owners');

async function setMonthlyBudget(accountId, actorUserId, monthKey, category, limitAmount, currency = 'IDR') {
  await assertOwner(accountId, actorUserId);
  await ensureSchema();
  await pool.execute(
    `INSERT INTO budgets (account_id, month_key, category, limit_amount, currency)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE limit_amount = VALUES(limit_amount), currency = VALUES(currency), updated_at = CURRENT_TIMESTAMP`,
    [accountId, monthKey, category, limitAmount, currency],
  );
  await logAudit(accountId, actorUserId, 'budget_set', 'budget', `${monthKey}:${category}`, {
    limit_amount: limitAmount,
    currency,
  });
}

async function listMonthlyBudgets(accountId, monthKey) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT category, limit_amount, currency FROM budgets WHERE account_id = ? AND month_key = ? ORDER BY category ASC`,
    [accountId, monthKey],
  );
  return rows;
}

async function getSpendingByCategory(accountId, startDate, endDate, targetCurrency = 'IDR') {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT category, amount, currency
     FROM transactions
     WHERE account_id = ? AND type = 'OUT' AND transaction_date >= ? AND transaction_date <= ?`,
    [accountId, startDate, endDate],
  );
  const totals = {};
  rows.forEach((r) => {
    const amount = convertAmount(parseFloat(r.amount), r.currency, targetCurrency);
    totals[r.category] = (totals[r.category] || 0) + amount;
  });
  return totals;
}

async function tryMarkBudgetNotification(accountId, monthKey, category, level) {
  await ensureSchema();
  const [result] = await pool.execute(
    `INSERT IGNORE INTO budget_notifications (account_id, month_key, category, level)
     VALUES (?, ?, ?, ?)`,
    [accountId, monthKey, category, level],
  );
  return (result.affectedRows || 0) > 0;
}

module.exports = {
  setMonthlyBudget,
  listMonthlyBudgets,
  getSpendingByCategory,
  tryMarkBudgetNotification,
};
