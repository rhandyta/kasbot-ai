const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.db);

// Currency conversion helper
function convertAmount(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  // Simplified exchange rates (hardcoded for demo)
  const rates = {
    'IDR': 1,
    'USD': 15000,
    'EUR': 16000,
  };
  const rateFrom = rates[fromCurrency] || 1;
  const rateTo = rates[toCurrency] || 1;
  // Convert to IDR then to target currency
  const amountInIDR = amount * rateFrom;
  return amountInIDR / rateTo;
}

// User settings functions
async function getUserCurrency(userId) {
  console.log(`Getting currency for user ${userId}`);
  const sql = `SELECT currency FROM user_settings WHERE user_id = ?`;
  const [rows] = await pool.execute(sql, [userId]);
  if (rows.length === 0) {
    return 'IDR'; // default
  }
  return rows[0].currency;
}

async function setUserCurrency(userId, currency) {
  console.log(`Setting currency for user ${userId} to ${currency}`);
  const sql = `
    INSERT INTO user_settings (user_id, currency)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE currency = ?, updated_at = CURRENT_TIMESTAMP
  `;
  await pool.execute(sql, [userId, currency, currency]);
}

/**
 * Inserts a transaction record along with its itemized details into the database.
 * Uses a database transaction to ensure data integrity.
 * @param {object} txData The structured transaction data from the AI.
 */
async function insertTransaction(txData) {
  console.log('Inserting itemized transaction into database:', txData);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Insert the main transaction record
    const { transaction_date, tipe, nominal, kategori, keterangan, receipt_path, items, currency = 'IDR' } = txData;
    const mainSql = `
      INSERT INTO transactions (transaction_date, type, amount, currency, category, description, receipt_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const [mainResult] = await connection.execute(mainSql, [transaction_date, tipe, nominal, currency, kategori, keterangan, receipt_path]);
    const transactionId = mainResult.insertId;
    console.log(`Main transaction inserted with ID: ${transactionId}`);

    // 2. Insert the itemized details, if they exist
    if (items && items.length > 0) {
      const itemsSql = `
        INSERT INTO transaction_items (transaction_id, item_name, quantity, price)
        VALUES ?
      `;
      const itemValues = items.map(item => [transactionId, item.item_name, item.quantity, item.price]);
      await connection.query(itemsSql, [itemValues]);
      console.log(`Inserted ${items.length} items for transaction ID: ${transactionId}`);
    }

    await connection.commit();
    console.log(`Transaction ${transactionId} committed successfully.`);
    return transactionId;

  } catch (error) {
    await connection.rollback();
    console.error('Error inserting transaction, rolled back.', error);
    throw new Error('Database insert failed.');
  } finally {
    connection.release();
  }
}

/**
 * Fetches transactions and their associated items within a date range.
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {Promise<Array<object>>} A list of transaction objects, each with an 'items' array.
 */
/**
 * Fetches transactions and their associated items within a date range.
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} targetCurrency Optional target currency code (e.g., 'USD'). If provided, amounts will be converted.
 * @returns {Promise<Array<object>>} A list of transaction objects, each with an 'items' array.
 */
async function getTransactions(startDate, endDate, targetCurrency = null) {
  console.log(`Fetching transactions from ${startDate} to ${endDate}`);
  
  // 1. Fetch main transaction records
  const mainSql = `
    SELECT id, transaction_date, type, amount, currency, category, description
    FROM transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
    ORDER BY transaction_date DESC, id DESC
  `;
  const [transactions] = await pool.execute(mainSql, [startDate, endDate]);

  if (transactions.length === 0) {
    return [];
  }

  // 2. Fetch all related items in a single query for efficiency
  const transactionIds = transactions.map(tx => tx.id);
  const itemsSql = `
    SELECT transaction_id, item_name, quantity, price
    FROM transaction_items
    WHERE transaction_id IN (?)
  `;
  const [items] = await pool.query(itemsSql, [transactionIds]);

  // 3. Map items back to their parent transactions
  const itemMap = {};
  items.forEach(item => {
    if (!itemMap[item.transaction_id]) {
      itemMap[item.transaction_id] = [];
    }
    itemMap[item.transaction_id].push(item);
  });

  transactions.forEach(tx => {
    tx.items = itemMap[tx.id] || [];
  });

  // 4. Convert currency if targetCurrency is provided
  if (targetCurrency) {
    transactions.forEach(tx => {
      if (tx.currency !== targetCurrency) {
        tx.amount = convertAmount(tx.amount, tx.currency, targetCurrency);
        tx.currency = targetCurrency;
      }
      // Convert item prices as well
      tx.items.forEach(item => {
        if (tx.currency !== targetCurrency) {
          item.price = convertAmount(item.price, tx.currency, targetCurrency);
        }
      });
    });
  }

  return transactions;
}

/**
 * Fetches the last N transactions and their associated items.
 * @param {number} limit The number of transactions to fetch.
 * @param {string} targetCurrency Optional target currency code (e.g., 'USD'). If provided, amounts will be converted.
 * @returns {Promise<Array<object>>} A list of transaction objects, each with an 'items' array.
 */
async function getLastTransactions(limit, targetCurrency = null) {
  console.log(`Fetching last ${limit} transactions`);

  // 1. Fetch main transaction records
  const mainSql = `
    SELECT id, transaction_date, type, amount, currency, category, description
    FROM transactions
    ORDER BY transaction_date DESC, id DESC
    LIMIT ?
  `;
  const [transactions] = await pool.query(mainSql, [limit]);

  if (transactions.length === 0) {
    return [];
  }

  // 2. Fetch all related items in a single query for efficiency
  const transactionIds = transactions.map(tx => tx.id);
  const itemsSql = `
    SELECT transaction_id, item_name, quantity, price
    FROM transaction_items
    WHERE transaction_id IN (?)
  `;
  const [items] = await pool.query(itemsSql, [transactionIds]);

  // 3. Map items back to their parent transactions
  const itemMap = {};
  items.forEach(item => {
    if (!itemMap[item.transaction_id]) {
      itemMap[item.transaction_id] = [];
    }
    itemMap[item.transaction_id].push(item);
  });

  transactions.forEach(tx => {
    tx.items = itemMap[tx.id] || [];
  });

  // 4. Convert currency if targetCurrency is provided
  if (targetCurrency) {
    transactions.forEach(tx => {
      if (tx.currency !== targetCurrency) {
        tx.amount = convertAmount(tx.amount, tx.currency, targetCurrency);
        tx.currency = targetCurrency;
      }
      // Convert item prices as well
      tx.items.forEach(item => {
        if (tx.currency !== targetCurrency) {
          item.price = convertAmount(item.price, tx.currency, targetCurrency);
        }
      });
    });
  }

  return transactions;
}

/**
 * Deletes the most recently inserted transaction (and its associated items via cascade).
 * @returns {Promise<number>} The ID of the deleted transaction.
 */
async function deleteLastTransaction() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Get the last transaction id
    const [rows] = await connection.execute('SELECT id FROM transactions ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) {
      throw new Error('No transaction found');
    }
    const transactionId = rows[0].id;
    // Delete the transaction (cascade will delete items)
    await connection.execute('DELETE FROM transactions WHERE id = ?', [transactionId]);
    await connection.commit();
    return transactionId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function searchTransactions(keyword) {
  console.log(`Searching transactions for keyword: ${keyword}`);
  const searchPattern = `%${keyword}%`;

  // 1. Fetch main transaction records matching keyword in description or item_name
  const mainSql = `
    SELECT DISTINCT t.id, t.transaction_date, t.type, t.amount, t.category, t.description
    FROM transactions t
    LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
    WHERE t.description LIKE ? OR ti.item_name LIKE ?
    ORDER BY t.transaction_date DESC, t.id DESC
  `;
  const [transactions] = await pool.execute(mainSql, [searchPattern, searchPattern]);

  if (transactions.length === 0) {
    return [];
  }

  // 2. Fetch items for those transactions
  const transactionIds = transactions.map(tx => tx.id);
  const itemsSql = `
    SELECT transaction_id, item_name, quantity, price
    FROM transaction_items
    WHERE transaction_id IN (?)
  `;
  const [items] = await pool.query(itemsSql, [transactionIds]);

  // 3. Map items back to their parent transactions
  const itemMap = {};
  items.forEach(item => {
    if (!itemMap[item.transaction_id]) {
      itemMap[item.transaction_id] = [];
    }
    itemMap[item.transaction_id].push(item);
  });

  transactions.forEach(tx => {
    tx.items = itemMap[tx.id] || [];
  });

  return transactions;
}

async function updateTransaction(id, updates) {
  console.log(`Updating transaction ${id} with:`, updates);
  const allowedColumns = ['transaction_date', 'type', 'amount', 'category', 'description'];
  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedColumns.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    } else {
      console.warn(`Ignoring unknown column: ${key}`);
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No valid columns to update');
  }

  values.push(id); // for WHERE clause

  const sql = `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(sql, values);
    if (result.affectedRows === 0) {
      throw new Error(`Transaction with ID ${id} not found`);
    }
    await connection.commit();
    console.log(`Transaction ${id} updated successfully.`);
    return id;
  } catch (error) {
    await connection.rollback();
    console.error('Error updating transaction:', error);
    throw new Error('Failed to update transaction');
  } finally {
    connection.release();
  }
}

module.exports = { insertTransaction, getTransactions, getLastTransactions, deleteLastTransaction, searchTransactions, updateTransaction, getUserCurrency, setUserCurrency, convertAmount };
