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
      merchant,
      keterangan,
      receipt_path,
      receipt_hash,
      text_hash,
      fingerprint_hash,
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
        merchant,
        description,
        receipt_path,
        receipt_hash,
        text_hash,
        fingerprint_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [mainResult] = await connection.execute(mainSql, [
      accountId,
      transaction_date,
      tipe,
      nominal,
      currency,
      kategori,
      merchant || null,
      keterangan,
      receipt_path,
      receipt_hash || null,
      text_hash || null,
      fingerprint_hash || null,
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
      merchant,
      receipt_path,
      receipt_hash,
      text_hash,
      fingerprint_hash,
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
    SELECT id, transaction_date, type, amount, currency, category, merchant, description, receipt_path, receipt_hash, text_hash, fingerprint_hash
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
    SELECT id, transaction_date, type, amount, currency, category, merchant, description, receipt_path, receipt_hash, text_hash, fingerprint_hash
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
      `SELECT id, transaction_date, type, amount, currency, category, merchant, description, receipt_path, receipt_hash, text_hash, fingerprint_hash
       FROM transactions
       WHERE account_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [accountId],
    );
    if (rows.length === 0) throw new Error('No transaction found');
    const tx = rows[0];
    const transactionId = tx.id;

    const [items] = await connection.execute(
      `SELECT item_name, quantity, price
       FROM transaction_items
       WHERE transaction_id = ?
       ORDER BY id ASC`,
      [transactionId],
    );

    const [deletedResult] = await connection.execute(
      `INSERT INTO deleted_transactions (
        original_transaction_id,
        account_id,
        deleted_by_user_id,
        transaction_date,
        type,
        amount,
        currency,
        category,
        merchant,
        description,
        receipt_path,
        receipt_hash,
        text_hash,
        fingerprint_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transactionId,
        accountId,
        actorUserId,
        tx.transaction_date,
        tx.type,
        tx.amount,
        tx.currency,
        tx.category,
        tx.merchant,
        tx.description,
        tx.receipt_path,
        tx.receipt_hash,
        tx.text_hash,
        tx.fingerprint_hash,
      ],
    );
    const deletedId = deletedResult.insertId;
    if (items.length > 0) {
      const values = items.map((it) => [deletedId, it.item_name, it.quantity, it.price]);
      await connection.query(
        `INSERT INTO deleted_transaction_items (deleted_transaction_id, item_name, quantity, price) VALUES ?`,
        [values],
      );
    }

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

async function deleteTransactionById(accountId, transactionId, actorUserId = null) {
  await ensureSchema();
  const id = parseInt(transactionId, 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Transaction id invalid');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, transaction_date, type, amount, currency, category, merchant, description, receipt_path, receipt_hash, text_hash, fingerprint_hash
       FROM transactions
       WHERE account_id = ? AND id = ?
       LIMIT 1`,
      [accountId, id],
    );
    if (rows.length === 0) throw new Error('Transaction not found');
    const tx = rows[0];

    const [items] = await connection.execute(
      `SELECT item_name, quantity, price
       FROM transaction_items
       WHERE transaction_id = ?
       ORDER BY id ASC`,
      [id],
    );

    const [deletedResult] = await connection.execute(
      `INSERT INTO deleted_transactions (
        original_transaction_id,
        account_id,
        deleted_by_user_id,
        transaction_date,
        type,
        amount,
        currency,
        category,
        merchant,
        description,
        receipt_path,
        receipt_hash,
        text_hash,
        fingerprint_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId,
        actorUserId,
        tx.transaction_date,
        tx.type,
        tx.amount,
        tx.currency,
        tx.category,
        tx.merchant,
        tx.description,
        tx.receipt_path,
        tx.receipt_hash,
        tx.text_hash,
        tx.fingerprint_hash,
      ],
    );
    const deletedId = deletedResult.insertId;
    if (items.length > 0) {
      const values = items.map((it) => [deletedId, it.item_name, it.quantity, it.price]);
      await connection.query(
        `INSERT INTO deleted_transaction_items (deleted_transaction_id, item_name, quantity, price) VALUES ?`,
        [values],
      );
    }

    await connection.execute('DELETE FROM transactions WHERE id = ? AND account_id = ?', [id, accountId]);
    await connection.commit();
    await logAudit(accountId, actorUserId, 'transaction_delete', 'transaction', String(id), {});
    return id;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function searchTransactions(accountId, keyword, options = null) {
  await ensureSchema();
  const limit = options?.limit ? Math.min(parseInt(options.limit, 10), 100) : 50;
  const offset = options?.offset ? Math.max(parseInt(options.offset, 10), 0) : 0;
  const searchPattern = `%${keyword}%`;

  const mainSql = `
    SELECT DISTINCT t.id, t.transaction_date, t.type, t.amount, t.currency, t.category, t.merchant, t.description, t.receipt_path, t.receipt_hash
    FROM transactions t
    LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
    WHERE t.account_id = ? AND (t.description LIKE ? OR ti.item_name LIKE ?)
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `;
  const [transactions] = await pool.execute(mainSql, [
    accountId,
    searchPattern,
    searchPattern,
    limit,
    offset,
  ]);
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

async function findTransactionByTextHash(accountId, textHash) {
  await ensureSchema();
  if (!textHash) return null;
  const [rows] = await pool.execute(
    `SELECT id, transaction_date FROM transactions WHERE account_id = ? AND text_hash = ? ORDER BY id DESC LIMIT 1`,
    [accountId, textHash],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, transaction_date: rows[0].transaction_date };
}

async function findTransactionByFingerprint(accountId, fingerprintHash) {
  await ensureSchema();
  if (!fingerprintHash) return null;
  const [rows] = await pool.execute(
    `SELECT id, transaction_date FROM transactions WHERE account_id = ? AND fingerprint_hash = ? ORDER BY id DESC LIMIT 1`,
    [accountId, fingerprintHash],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, transaction_date: rows[0].transaction_date };
}

async function restoreLastDeletedTransaction(accountId, actorUserId = null) {
  await ensureSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, original_transaction_id, transaction_date, type, amount, currency, category, merchant, description, receipt_path, receipt_hash, text_hash, fingerprint_hash
       FROM deleted_transactions
       WHERE account_id = ?
       ORDER BY deleted_at DESC, id DESC
       LIMIT 1`,
      [accountId],
    );
    if (rows.length === 0) throw new Error('Tidak ada transaksi yang bisa dikembalikan.');
    const del = rows[0];

    const [items] = await connection.execute(
      `SELECT item_name, quantity, price
       FROM deleted_transaction_items
       WHERE deleted_transaction_id = ?
       ORDER BY id ASC`,
      [del.id],
    );

    const [inserted] = await connection.execute(
      `INSERT INTO transactions (
        account_id,
        transaction_date,
        type,
        amount,
        currency,
        category,
        merchant,
        description,
        receipt_path,
        receipt_hash,
        text_hash,
        fingerprint_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        del.transaction_date,
        del.type,
        del.amount,
        del.currency,
        del.category,
        del.merchant,
        del.description,
        del.receipt_path,
        del.receipt_hash,
        del.text_hash,
        del.fingerprint_hash,
      ],
    );
    const newTransactionId = inserted.insertId;

    if (items.length > 0) {
      const values = items.map((it) => [newTransactionId, it.item_name, it.quantity, it.price]);
      await connection.query(
        `INSERT INTO transaction_items (transaction_id, item_name, quantity, price) VALUES ?`,
        [values],
      );
    }

    await connection.execute(`DELETE FROM deleted_transaction_items WHERE deleted_transaction_id = ?`, [
      del.id,
    ]);
    await connection.execute(`DELETE FROM deleted_transactions WHERE id = ?`, [del.id]);

    await connection.commit();
    await logAudit(accountId, actorUserId, 'transaction_restore_last', 'transaction', String(newTransactionId), {
      original_transaction_id: del.original_transaction_id,
    });
    return newTransactionId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getTransactionsForExport(accountId, startDate, endDate) {
  await ensureSchema();
  const [txRows] = await pool.execute(
    `SELECT id, transaction_date, type, amount, currency, category, merchant, description, receipt_path
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

async function getSummaryTotals(accountId, startDate, endDate) {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT type, SUM(amount) AS total, currency
     FROM transactions
     WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ?
     GROUP BY type, currency`,
    [accountId, startDate, endDate],
  );
  return rows;
}

async function tryMarkSummaryNotification(accountId, kind, periodKey) {
  await ensureSchema();
  const [result] = await pool.execute(
    `INSERT IGNORE INTO summary_notifications (account_id, kind, period_key)
     VALUES (?, ?, ?)`,
    [accountId, kind, periodKey],
  );
  return (result.affectedRows || 0) > 0;
}

async function detachOldReceipts(retentionDays) {
  await ensureSchema();
  const days = Math.max(parseInt(retentionDays, 10) || 0, 1);
  const [rows] = await pool.execute(
    `SELECT id, account_id, receipt_path
     FROM transactions
     WHERE receipt_path IS NOT NULL
       AND created_at < (NOW() - INTERVAL ? DAY)
     ORDER BY id ASC
     LIMIT 500`,
    [days],
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  await pool.query(
    `UPDATE transactions
     SET receipt_path = NULL, receipt_hash = NULL
     WHERE id IN (?)`,
    [ids],
  );
  return rows.map((r) => ({ id: r.id, account_id: r.account_id, receipt_path: r.receipt_path }));
}

module.exports = {
  insertTransaction,
  getTransactions,
  getLastTransactions,
  deleteLastTransaction,
  deleteTransactionById,
  searchTransactions,
  updateTransaction,
  getLastReceiptTransaction,
  findTransactionByReceiptHash,
  findTransactionByTextHash,
  findTransactionByFingerprint,
  restoreLastDeletedTransaction,
  getTransactionsForExport,
  getSummaryTotals,
  tryMarkSummaryNotification,
  detachOldReceipts,
};
