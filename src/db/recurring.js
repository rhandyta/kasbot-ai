const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { logAudit } = require('./audit');
const { assertOwner } = require('./owners');
const { insertTransaction } = require('./transactions');

async function addRecurringRule(accountId, actorUserId, rule) {
  await assertOwner(accountId, actorUserId);
  await ensureSchema();
  const { type, amount, currency = 'IDR', category, description = null, day_of_month } = rule;
  const day = parseInt(day_of_month, 10);
  if (!Number.isFinite(day) || day < 1 || day > 28) {
    throw new Error('Tanggal harus 1-28.');
  }
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), day);
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    next.setMonth(next.getMonth() + 1);
  }
  const nextRun = next.toISOString().slice(0, 10);
  const [result] = await pool.execute(
    `INSERT INTO recurring_rules (account_id, type, amount, currency, category, description, day_of_month, next_run_date, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [accountId, type, amount, currency, category, description, day, nextRun],
  );
  await logAudit(accountId, actorUserId, 'recurring_add', 'recurring_rule', String(result.insertId), rule);
  return { id: result.insertId, next_run_date: nextRun };
}

async function listRecurringRules(accountId) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT id, type, amount, currency, category, description, day_of_month, next_run_date, active
     FROM recurring_rules
     WHERE account_id = ?
     ORDER BY id DESC`,
    [accountId],
  );
  return rows.map((r) => ({ ...r, active: !!r.active }));
}

async function removeRecurringRule(accountId, actorUserId, ruleId) {
  await assertOwner(accountId, actorUserId);
  await ensureSchema();
  await pool.execute(`UPDATE recurring_rules SET active = 0 WHERE account_id = ? AND id = ?`, [
    accountId,
    ruleId,
  ]);
  await logAudit(accountId, actorUserId, 'recurring_disable', 'recurring_rule', String(ruleId), {});
}

function computeNextMonthlyDate(baseDate, dayOfMonth) {
  const d = new Date(baseDate);
  const target = new Date(d.getFullYear(), d.getMonth() + 1, dayOfMonth);
  return target.toISOString().slice(0, 10);
}

async function runDueRecurring(accountId) {
  await ensureSchema();
  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await pool.execute(
    `SELECT id, type, amount, currency, category, description, day_of_month, next_run_date
     FROM recurring_rules
     WHERE account_id = ? AND active = 1 AND next_run_date <= ?
     ORDER BY next_run_date ASC, id ASC`,
    [accountId, today],
  );
  if (rows.length === 0) return [];

  const created = [];
  for (const r of rows) {
    const txData = {
      transaction_date: r.next_run_date,
      tipe: r.type,
      nominal: parseFloat(r.amount),
      currency: r.currency,
      kategori: r.category,
      keterangan: r.description || 'Transaksi berulang',
      items: [],
    };
    const txId = await insertTransaction(accountId, txData, null);
    const nextRun = computeNextMonthlyDate(new Date(r.next_run_date), r.day_of_month);
    await pool.execute(`UPDATE recurring_rules SET next_run_date = ? WHERE account_id = ? AND id = ?`, [
      nextRun,
      accountId,
      r.id,
    ]);
    await logAudit(accountId, null, 'recurring_run', 'recurring_rule', String(r.id), {
      transaction_id: txId,
    });
    created.push({ rule_id: r.id, transaction_id: txId });
  }
  return created;
}

module.exports = { addRecurringRule, listRecurringRules, removeRecurringRule, runDueRecurring };
