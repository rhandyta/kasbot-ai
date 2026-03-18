const { pool } = require('./pool');
const { ensureSchema } = require('./schema');
const { convertAmount } = require('./currency');
const { logAudit } = require('./audit');

async function insertTransaction(accountId, txData, actorUserId = null) {
  await ensureSchema();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      transaction_date,
      tipe,
      nominal,
      kategori,
      keterangan,
      receipt_path,
      receipt_hash,
      items,
      currency = 'IDR',
    } = txData;
    const mainSql = `
      INSERT INTO transactions (
        account_id,
        transaction_date,
        type,
        amount,
        currency,
        category,
        description,
        receipt_path,
        receipt_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [mainResult] = await connection.execute(mainSql, [
      accountId,
      transaction_date,
      tipe,
      nominal,
      currency,
      kategori,
      keterangan,
      receipt_path,
      receipt_hash || null,
    ]);
    const transactionId = mainResult.insertId;

    if (items && items.length > 0) {
      const itemsSql = `
        INSERT INTO transaction_items (transaction_id, item_name, quantity, price)
        VALUES ?
      `;
      const itemValues = items.map((item) => [
        transactionId,
        item.item_name,
        item.quantity,
        item.price,
      ]);
      await connection.query(itemsSql, [itemValues]);
    }

    await connection.commit();
    await logAudit(accountId, actorUserId, 'transaction_insert', 'transaction', String(transactionId), {
      transaction_date,
      tipe,
      nominal,
      currency,
      kategori,
      receipt_path,
      receipt_hash,
    });
    return transactionId;
  } catch (error) {
    await connection.rollback();
    throw new Error('Database insert failed.');
  } finally {
    connection.release();
  }
}

async function getTransactions(accountId, startDate, endDate, targetCurrency = null) {
  await ensureSchema();

  const mainSql = `
    SELECT id, transaction_date, type, amount, currency, category, description, receipt_path, receipt_hash
    FROM transactions
    WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ?
    ORDER BY transaction_date DESC, id DESC
  `;
  const [transactions] = await pool.execute(mainSql, [accountId, startDate, endDate]);

  if (transactions.length === 0) return [];

  const transactionIds = transactions.map((tx) => tx.id);
  const itemsSql = `
    SELECT transaction_id, item_name, quantity, price
    FROM transaction_items
    WHERE transaction_id IN (?)
  `;
  const [items] = await pool.query(itemsSql, [transactionIds]);

  const itemMap = {};
  items.forEach((item) => {
    if (!itemMap[item.transaction_id]) itemMap[item.transaction_id] = [];
    itemMap[item.transaction_id].push(item);
  });

  transactions.forEach((tx) => {
    tx.items = itemMap[tx.id] || [];
  });

  if (targetCurrency) {
    transactions.forEach((tx) => {
      if (tx.currency !== targetCurrency) {
        tx.amount = convertAmount(parseFloat(tx.amount), tx.currency, targetCurrency);
        tx.currency = targetCurrency;
      }
      tx.items.forEach((item) => {
        item.price = convertAmount(parseFloat(item.price), tx.currency, targetCurrency);
      });
    });
  }

  return transactions;
}

async function getLastTransactions(accountId, limit, targetCurrency = null) {
  await ensureSchema();

  const mainSql = `
    SELECT id, transaction_date, type, amount, currency, category, description, receipt_path, receipt_hash
    FROM transactions
    WHERE account_id = ?
    ORDER BY transaction_date DESC, id DESC
    LIMIT ?
  `;
  const [transactions] = await pool.query(mainSql, [accountId, limit]);
  if (transactions.length === 0) return [];

  const transactionIds = transactions.map((tx) => tx.id);
  const itemsSql = `
    SELECT transaction_id, item_name, quantity, price
    FROM transaction_items
    WHERE transaction_id IN (?)
  `;
  const [items] = await pool.query(itemsSql, [transactionIds]);

  const itemMap = {};
  items.forEach((item) => {
    if (!itemMap[item.transaction_id]) itemMap[item.transaction_id] = [];
    itemMap[item.transaction_id].push(item);
  });

  transactions.forEach((tx) => {
    tx.items = itemMap[tx.id] || [];
  });

  if (targetCurrency) {
    transactions.forEach((tx) => {
      if (tx.currency !== targetCurrency) {
        tx.amount = convertAmount(parseFloat(tx.amount), tx.currency, targetCurrency);
        tx.currency = targetCurrency;
      }
      tx.items.forEach((item) => {
        item.price = convertAmount(parseFloat(item.price), tx.currency, targetCurrency);
      });
    });
  }

  return transactions;
}

async function deleteLastTransaction(accountId, actorUserId = null) {
  await ensureSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id FROM transactions WHERE account_id = ? ORDER BY id DESC LIMIT 1',
      [accountId],
    );
    if (rows.length === 0) throw new Error('No transaction found');
    const transactionId = rows[0].id;
    await connection.execute('DELETE FROM transactions WHERE id = ? AND account_id = ?', [
      transactionId,
      accountId,
    ]);
    await connection.commit();
    await logAudit(accountId, actorUserId, 'transaction_delete_last', 'transaction', String(transactionId), {});
    return transactionId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function searchTransactions(accountId, keyword) {
  await ensureSchema();
  const searchPattern = `%${keyword}%`;

  const mainSql = `
    SELECT DISTINCT t.id, t.transaction_date, t.type, t.amount, t.currency, t.category, t.description, t.receipt_path, t.receipt_hash
    FROM transactions t
    LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
    WHERE t.account_id = ? AND (t.description LIKE ? OR ti.item_name LIKE ?)
    ORDER BY t.transaction_date DESC, t.id DESC
  `;
  const [transactions] = await pool.execute(mainSql, [accountId, searchPattern, searchPattern]);
  if (transactions.length === 0) return [];

  const transactionIds = transactions.map((tx) => tx.id);
  const itemsSql = `
    SELECT transaction_id, item_name, quantity, price
    FROM transaction_items
    WHERE transaction_id IN (?)
  `;
  const [items] = await pool.query(itemsSql, [transactionIds]);

  const itemMap = {};
  items.forEach((item) => {
    if (!itemMap[item.transaction_id]) itemMap[item.transaction_id] = [];
    itemMap[item.transaction_id].push(item);
  });

  transactions.forEach((tx) => {
    tx.items = itemMap[tx.id] || [];
  });

  return transactions;
}

async function updateTransaction(accountId, id, updates, actorUserId = null) {
  await ensureSchema();
  const allowedColumns = ['transaction_date', 'type', 'amount', 'category', 'description'];
  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedColumns.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (setClauses.length === 0) throw new Error('No valid columns to update');

  values.push(id);
  values.push(accountId);

  const sql = `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ? AND account_id = ?`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(sql, values);
    if (result.affectedRows === 0) throw new Error(`Transaction with ID ${id} not found`);
    await connection.commit();
    await logAudit(accountId, actorUserId, 'transaction_update', 'transaction', String(id), updates);
    return id;
  } catch (error) {
    await connection.rollback();
    throw new Error('Failed to update transaction');
  } finally {
    connection.release();
  }
}

async function getLastReceiptTransaction(accountId) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT id, receipt_path FROM transactions WHERE account_id = ? AND receipt_path IS NOT NULL ORDER BY id DESC LIMIT 1`,
    [accountId],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, receipt_path: rows[0].receipt_path };
}

async function findTransactionByReceiptHash(accountId, receiptHash) {
  await ensureSchema();
  if (!receiptHash) return null;
  const [rows] = await pool.execute(
    `SELECT id, transaction_date FROM transactions WHERE account_id = ? AND receipt_hash = ? ORDER BY id DESC LIMIT 1`,
    [accountId, receiptHash],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, transaction_date: rows[0].transaction_date };
}

async function getTransactionsForExport(accountId, startDate, endDate) {
  await ensureSchema();
  const [txRows] = await pool.execute(
    `SELECT id, transaction_date, type, amount, currency, category, description, receipt_path
     FROM transactions
     WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ?
     ORDER BY transaction_date ASC, id ASC`,
    [accountId, startDate, endDate],
  );
  if (txRows.length === 0) return [];
  const ids = txRows.map((t) => t.id);
  const [items] = await pool.query(
    `SELECT transaction_id, item_name, quantity, price
     FROM transaction_items
     WHERE transaction_id IN (?)`,
    [ids],
  );
  const itemMap = {};
  items.forEach((it) => {
    if (!itemMap[it.transaction_id]) itemMap[it.transaction_id] = [];
    itemMap[it.transaction_id].push(it);
  });
  return txRows.map((t) => ({ ...t, items: itemMap[t.id] || [] }));
}

module.exports = {
  insertTransaction,
  getTransactions,
  getLastTransactions,
  deleteLastTransaction,
  searchTransactions,
  updateTransaction,
  getLastReceiptTransaction,
  findTransactionByReceiptHash,
  getTransactionsForExport,
};
