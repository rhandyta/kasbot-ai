const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.db);

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
    const { transaction_date, tipe, nominal, kategori, keterangan, receipt_path, items } = txData;
    const mainSql = `
      INSERT INTO transactions (transaction_date, type, amount, category, description, receipt_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [mainResult] = await connection.execute(mainSql, [transaction_date, tipe, nominal, kategori, keterangan, receipt_path]);
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
async function getTransactions(startDate, endDate) {
  console.log(`Fetching transactions from ${startDate} to ${endDate}`);
  
  // 1. Fetch main transaction records
  const mainSql = `
    SELECT id, transaction_date, type, amount, category, description 
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

  return transactions;
}

/**
 * Fetches the last N transactions and their associated items.
 * @param {number} limit The number of transactions to fetch.
 * @returns {Promise<Array<object>>} A list of transaction objects, each with an 'items' array.
 */
async function getLastTransactions(limit) {
  console.log(`Fetching last ${limit} transactions`);

  // 1. Fetch main transaction records
  const mainSql = `
    SELECT id, transaction_date, type, amount, category, description 
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

  return transactions;
}

module.exports = { insertTransaction, getTransactions, getLastTransactions };
