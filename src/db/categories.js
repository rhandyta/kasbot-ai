const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { assertOwner } = require('./owners');
const { logAudit } = require('./audit');

function normalizeKeyword(keyword) {
  return keyword.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function addCategory(accountId, actorUserId, name) {
  await assertOwner(accountId, actorUserId);
  await ensureSchema();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nama kategori kosong.');
  await pool.execute(
    `INSERT IGNORE INTO categories (account_id, name) VALUES (?, ?)`,
    [accountId, trimmed],
  );
  await logAudit(accountId, actorUserId, 'category_add', 'category', trimmed, {});
}

async function listCategories(accountId) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT name FROM categories WHERE account_id = ? ORDER BY name ASC`,
    [accountId],
  );
  return rows.map((r) => r.name);
}

async function upsertMerchantRule(accountId, actorUserId, keyword, categoryName) {
  await assertOwner(accountId, actorUserId);
  await ensureSchema();
  const k = normalizeKeyword(keyword);
  const c = categoryName.trim();
  if (!k) throw new Error('Keyword kosong.');
  if (!c) throw new Error('Kategori kosong.');

  await pool.execute(
    `INSERT INTO merchant_category_rules (account_id, keyword, category_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE category_name = VALUES(category_name)`,
    [accountId, k, c],
  );
  await pool.execute(
    `INSERT IGNORE INTO categories (account_id, name) VALUES (?, ?)`,
    [accountId, c],
  );
  await logAudit(accountId, actorUserId, 'merchant_rule_upsert', 'merchant_rule', k, { category: c });
}

async function listMerchantRules(accountId) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT keyword, category_name FROM merchant_category_rules WHERE account_id = ? ORDER BY keyword ASC`,
    [accountId],
  );
  return rows.map((r) => ({ keyword: r.keyword, category: r.category_name }));
}

async function resolveCategoryFromText(accountId, text) {
  await ensureSchema();
  const normalized = (text || '').toLowerCase();
  if (!normalized) return null;
  const [rows] = await pool.execute(
    `SELECT keyword, category_name FROM merchant_category_rules WHERE account_id = ?`,
    [accountId],
  );
  let best = null;
  rows.forEach((r) => {
    const k = String(r.keyword || '').toLowerCase();
    if (!k) return;
    if (!normalized.includes(k)) return;
    if (!best || k.length > best.keyword.length) {
      best = { keyword: k, category: r.category_name };
    }
  });
  return best ? best.category : null;
}

module.exports = {
  addCategory,
  listCategories,
  upsertMerchantRule,
  listMerchantRules,
  resolveCategoryFromText,
};
