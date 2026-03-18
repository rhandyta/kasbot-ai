const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { convertAmount } = require('./currency');

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = toInt(value, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeBucket(bucket) {
  const b = String(bucket || '').toLowerCase().trim();
  if (b === 'day' || b === 'daily') return 'day';
  if (b === 'week' || b === 'weekly') return 'week';
  if (b === 'month' || b === 'monthly') return 'month';
  return 'day';
}

function normalizeType(type) {
  const t = String(type || '').toUpperCase().trim();
  if (t === 'IN' || t === 'OUT') return t;
  if (t === 'ALL' || t === '') return null;
  return null;
}

function yyyymm(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

async function getSummary(accountId, startDate, endDate, targetCurrency = 'IDR') {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT type, currency, SUM(amount) AS total
     FROM transactions
     WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ?
     GROUP BY type, currency`,
    [accountId, startDate, endDate],
  );

  let totalIn = 0;
  let totalOut = 0;
  rows.forEach((r) => {
    const amount = convertAmount(Number(r.total) || 0, r.currency || 'IDR', targetCurrency);
    if (r.type === 'IN') totalIn += amount;
    if (r.type === 'OUT') totalOut += amount;
  });

  const net = totalIn - totalOut;
  const savingRate = totalIn > 0 ? net / totalIn : null;
  return {
    startDate,
    endDate,
    currency: targetCurrency,
    totalIn,
    totalOut,
    net,
    savingRate,
  };
}

async function getTimeSeries(accountId, startDate, endDate, bucket = 'day', targetCurrency = 'IDR') {
  await ensureSchema();
  const b = normalizeBucket(bucket);
  const keyExpr =
    b === 'month'
      ? "DATE_FORMAT(transaction_date, '%Y-%m')"
      : b === 'week'
        ? "DATE_FORMAT(DATE_SUB(transaction_date, INTERVAL (DAYOFWEEK(transaction_date)+5) % 7 DAY), '%Y-%m-%d')"
        : "DATE_FORMAT(transaction_date, '%Y-%m-%d')";

  const [rows] = await pool.execute(
    `SELECT ${keyExpr} AS bucket_key, type, currency, SUM(amount) AS total
     FROM transactions
     WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ?
     GROUP BY bucket_key, type, currency
     ORDER BY bucket_key ASC`,
    [accountId, startDate, endDate],
  );

  const map = new Map();
  rows.forEach((r) => {
    const key = r.bucket_key;
    if (!map.has(key)) map.set(key, { key, in: 0, out: 0, net: 0 });
    const entry = map.get(key);
    const amount = convertAmount(Number(r.total) || 0, r.currency || 'IDR', targetCurrency);
    if (r.type === 'IN') entry.in += amount;
    if (r.type === 'OUT') entry.out += amount;
    entry.net = entry.in - entry.out;
  });

  return {
    startDate,
    endDate,
    bucket: b,
    currency: targetCurrency,
    series: Array.from(map.values()),
  };
}

async function getBreakdownByCategory(accountId, startDate, endDate, type = null, targetCurrency = 'IDR', limit = 20) {
  await ensureSchema();
  const t = normalizeType(type);
  const whereType = t ? 'AND type = ?' : '';
  const params = t ? [accountId, startDate, endDate, t] : [accountId, startDate, endDate];
  const [rows] = await pool.execute(
    `SELECT category, type, currency, SUM(amount) AS total
     FROM transactions
     WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ? ${whereType}
     GROUP BY category, type, currency`,
    params,
  );

  const map = new Map();
  rows.forEach((r) => {
    const key = `${r.type}:${r.category}`;
    if (!map.has(key)) map.set(key, { type: r.type, category: r.category, total: 0 });
    const amount = convertAmount(Number(r.total) || 0, r.currency || 'IDR', targetCurrency);
    map.get(key).total += amount;
  });

  const items = Array.from(map.values()).sort((a, b) => b.total - a.total);
  return { startDate, endDate, currency: targetCurrency, items: items.slice(0, limit) };
}

async function getBreakdownByMerchant(accountId, startDate, endDate, type = null, targetCurrency = 'IDR', limit = 20) {
  await ensureSchema();
  const t = normalizeType(type);
  const whereType = t ? 'AND type = ?' : '';
  const params = t ? [accountId, startDate, endDate, t] : [accountId, startDate, endDate];
  const [rows] = await pool.execute(
    `SELECT merchant, type, currency, SUM(amount) AS total
     FROM transactions
     WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ? ${whereType}
     GROUP BY merchant, type, currency`,
    params,
  );

  const map = new Map();
  rows.forEach((r) => {
    const name = r.merchant || 'Unknown';
    const key = `${r.type}:${name}`;
    if (!map.has(key)) map.set(key, { type: r.type, merchant: name, total: 0 });
    const amount = convertAmount(Number(r.total) || 0, r.currency || 'IDR', targetCurrency);
    map.get(key).total += amount;
  });

  const items = Array.from(map.values()).sort((a, b) => b.total - a.total);
  return { startDate, endDate, currency: targetCurrency, items: items.slice(0, limit) };
}

async function getBudgetStatus(accountId, monthKey, targetCurrency = 'IDR') {
  await ensureSchema();
  const mk = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mk)) throw new Error('month invalid');
  const startDate = `${mk}-01`;
  const endDate = `${mk}-${String(new Date(parseInt(mk.slice(0, 4), 10), parseInt(mk.slice(5, 7), 10), 0).getDate()).padStart(2, '0')}`;

  const [budgetRows] = await pool.execute(
    `SELECT category, limit_amount, currency FROM budgets WHERE account_id = ? AND month_key = ? ORDER BY category ASC`,
    [accountId, mk],
  );
  const [spendRows] = await pool.execute(
    `SELECT category, currency, SUM(amount) AS total
     FROM transactions
     WHERE account_id = ? AND type = 'OUT' AND transaction_date >= ? AND transaction_date <= ?
     GROUP BY category, currency`,
    [accountId, startDate, endDate],
  );
  const spentMap = new Map();
  spendRows.forEach((r) => {
    const key = r.category;
    const converted = convertAmount(Number(r.total) || 0, r.currency || 'IDR', targetCurrency);
    spentMap.set(key, (spentMap.get(key) || 0) + converted);
  });

  const items = budgetRows.map((b) => {
    const limit = convertAmount(Number(b.limit_amount) || 0, b.currency || 'IDR', targetCurrency);
    const spent = spentMap.get(b.category) || 0;
    const pct = limit > 0 ? spent / limit : null;
    return {
      category: b.category,
      limit,
      spent,
      pct,
      status: pct === null ? 'unknown' : pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok',
    };
  });

  return { monthKey: mk, startDate, endDate, currency: targetCurrency, items };
}

async function listTransactions(
  accountId,
  { startDate, endDate, type, category, merchant, q, limit, offset, includeItems },
  targetCurrency = null,
) {
  await ensureSchema();
  const lim = clampInt(limit, 1, 100, 20);
  const off = clampInt(offset, 0, 1_000_000, 0);
  const t = normalizeType(type);
  const where = ['t.account_id = ?'];
  const params = [accountId];

  if (startDate) {
    where.push('t.transaction_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('t.transaction_date <= ?');
    params.push(endDate);
  }
  if (t) {
    where.push('t.type = ?');
    params.push(t);
  }
  if (category) {
    where.push('t.category = ?');
    params.push(category);
  }
  if (merchant) {
    where.push('t.merchant = ?');
    params.push(merchant);
  }

  let joinItems = '';
  if (q) {
    const pattern = `%${q}%`;
    joinItems = 'LEFT JOIN transaction_items ti ON ti.transaction_id = t.id';
    where.push('(t.description LIKE ? OR ti.item_name LIKE ? OR t.merchant LIKE ? OR t.category LIKE ?)');
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.execute(
    `SELECT COUNT(DISTINCT t.id) AS cnt FROM transactions t ${joinItems} ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.cnt) || 0;

  const [rows] = await pool.execute(
    `SELECT DISTINCT t.id, t.transaction_date, t.type, t.amount, t.currency, t.category, t.merchant, t.description, t.receipt_path
     FROM transactions t
     ${joinItems}
     ${whereSql}
     ORDER BY t.transaction_date DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );

  if (targetCurrency) {
    rows.forEach((r) => {
      r.amount = convertAmount(Number(r.amount) || 0, r.currency || 'IDR', targetCurrency);
      r.currency = targetCurrency;
    });
  }

  if (!includeItems || rows.length === 0) {
    return { total, limit: lim, offset: off, rows };
  }

  const ids = rows.map((r) => r.id);
  const [items] = await pool.query(
    `SELECT transaction_id, item_name, quantity, price
     FROM transaction_items
     WHERE transaction_id IN (?)
     ORDER BY id ASC`,
    [ids],
  );
  const itemMap = {};
  items.forEach((it) => {
    if (!itemMap[it.transaction_id]) itemMap[it.transaction_id] = [];
    itemMap[it.transaction_id].push(it);
  });
  rows.forEach((r) => {
    r.items = itemMap[r.id] || [];
  });

  return { total, limit: lim, offset: off, rows };
}

async function getTransactionDetail(accountId, transactionId, targetCurrency = null) {
  await ensureSchema();
  const id = parseInt(transactionId, 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error('id invalid');
  const [rows] = await pool.execute(
    `SELECT id, transaction_date, type, amount, currency, category, merchant, description, receipt_path
     FROM transactions
     WHERE account_id = ? AND id = ?
     LIMIT 1`,
    [accountId, id],
  );
  if (rows.length === 0) return null;
  const tx = rows[0];
  const [items] = await pool.execute(
    `SELECT item_name, quantity, price
     FROM transaction_items
     WHERE transaction_id = ?
     ORDER BY id ASC`,
    [id],
  );
  tx.items = items;
  if (targetCurrency) {
    tx.amount = convertAmount(Number(tx.amount) || 0, tx.currency || 'IDR', targetCurrency);
    tx.currency = targetCurrency;
  }
  return tx;
}

async function listAuditLogs(accountId, { startDate, endDate, action, limit, offset }) {
  await ensureSchema();
  const lim = clampInt(limit, 1, 200, 50);
  const off = clampInt(offset, 0, 1_000_000, 0);
  const where = ['account_id = ?'];
  const params = [accountId];

  if (startDate) {
    where.push('created_at >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    where.push('created_at <= ?');
    params.push(`${endDate} 23:59:59`);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [countRows] = await pool.execute(`SELECT COUNT(*) AS cnt FROM audit_logs ${whereSql}`, params);
  const total = Number(countRows[0]?.cnt) || 0;

  const [rows] = await pool.execute(
    `SELECT id, user_id, action, entity_type, entity_id, detail_json, created_at
     FROM audit_logs
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );

  return { total, limit: lim, offset: off, rows };
}

module.exports = {
  getSummary,
  getTimeSeries,
  getBreakdownByCategory,
  getBreakdownByMerchant,
  getBudgetStatus,
  listTransactions,
  getTransactionDetail,
  listAuditLogs,
  yyyymm,
};

