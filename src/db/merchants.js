const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { assertOwner } = require('./owners');
const { logAudit } = require('./audit');

function normalizeKeyword(keyword) {
  return keyword.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function upsertMerchantRule(accountId, actorUserId, keyword, merchantName) {
  await assertOwner(accountId, actorUserId);
  await ensureSchema();
  const k = normalizeKeyword(keyword);
  const m = merchantName.trim();
  if (!k) throw new Error('Keyword kosong.');
  if (!m) throw new Error('Merchant kosong.');
  await pool.execute(
    `INSERT INTO merchant_normalization_rules (account_id, keyword, merchant_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE merchant_name = VALUES(merchant_name)`,
    [accountId, k, m],
  );
  await logAudit(accountId, actorUserId, 'merchant_rule_upsert', 'merchant_rule', k, { merchant: m });
}

async function listMerchantRules(accountId) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT keyword, merchant_name FROM merchant_normalization_rules WHERE account_id = ? ORDER BY keyword ASC`,
    [accountId],
  );
  return rows.map((r) => ({ keyword: r.keyword, merchant: r.merchant_name }));
}

async function resolveMerchantFromText(accountId, text) {
  await ensureSchema();
  const normalized = (text || '').toLowerCase();
  if (!normalized) return null;
  const [rows] = await pool.execute(
    `SELECT keyword, merchant_name FROM merchant_normalization_rules WHERE account_id = ?`,
    [accountId],
  );
  let best = null;
  rows.forEach((r) => {
    const k = String(r.keyword || '').toLowerCase();
    if (!k) return;
    if (!normalized.includes(k)) return;
    if (!best || k.length > best.keyword.length) {
      best = { keyword: k, merchant: r.merchant_name };
    }
  });
  return best ? best.merchant : null;
}

module.exports = { upsertMerchantRule, listMerchantRules, resolveMerchantFromText };
