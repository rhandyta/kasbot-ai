const mysql = require('mysql2/promise');
const config = require('./config');
const crypto = require('crypto');

const pool = mysql.createPool(config.db);

let schemaEnsured = null;

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

async function columnExists(tableName, columnName) {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
  `;
  const [rows] = await pool.execute(sql, [tableName, columnName]);
  return rows[0]?.cnt > 0;
}

function generateShareToken() {
  return crypto.randomBytes(18).toString('base64url');
}

async function ensureSchema() {
  if (schemaEnsured) return schemaEnsured;
  schemaEnsured = (async () => {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        share_token VARCHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS account_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        account_id INT NOT NULL,
        role ENUM('owner','viewer') NOT NULL DEFAULT 'viewer',
        can_write TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_account (user_id, account_id),
        INDEX idx_account_members_user (user_id),
        INDEX idx_account_members_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL UNIQUE,
        currency CHAR(3) DEFAULT 'IDR',
        active_account_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_settings_active_account (active_account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        account_id INT NOT NULL DEFAULT 1,
        transaction_date DATE NOT NULL,
        type ENUM('IN', 'OUT') NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        currency CHAR(3) DEFAULT 'IDR',
        category VARCHAR(255) NOT NULL,
        description TEXT,
        receipt_path VARCHAR(255),
        INDEX idx_transactions_account_date (account_id, transaction_date)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS transaction_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        price DECIMAL(15, 2) NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS account_invites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invite_token VARCHAR(64) NOT NULL UNIQUE,
        account_id INT NOT NULL,
        role ENUM('owner','viewer') NOT NULL DEFAULT 'viewer',
        can_write TINYINT(1) NOT NULL DEFAULT 0,
        created_by_user_id VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL,
        used_by_user_id VARCHAR(255) NULL,
        used_at TIMESTAMP NULL,
        revoked_at TIMESTAMP NULL,
        INDEX idx_account_invites_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        user_id VARCHAR(255) NULL,
        action VARCHAR(64) NOT NULL,
        entity_type VARCHAR(64) NULL,
        entity_id VARCHAR(64) NULL,
        detail_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_logs_account (account_id),
        INDEX idx_audit_logs_created (created_at)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS budgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        month_key CHAR(7) NOT NULL,
        category VARCHAR(255) NOT NULL,
        limit_amount DECIMAL(15, 2) NOT NULL,
        currency CHAR(3) DEFAULT 'IDR',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_budget (account_id, month_key, category),
        INDEX idx_budgets_account_month (account_id, month_key)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS recurring_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        type ENUM('IN', 'OUT') NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        currency CHAR(3) DEFAULT 'IDR',
        category VARCHAR(255) NOT NULL,
        description TEXT,
        day_of_month INT NOT NULL,
        next_run_date DATE NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_recurring_due (account_id, active, next_run_date)
      )
    `);

    if (!(await columnExists('transactions', 'account_id'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN account_id INT NOT NULL DEFAULT 1`);
      try {
        await pool.execute(`CREATE INDEX idx_transactions_account_date ON transactions (account_id, transaction_date)`);
      } catch (e) {
        if (!e || e.code !== 'ER_DUP_KEYNAME') throw e;
      }
    }

    if (!(await columnExists('transactions', 'receipt_hash'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN receipt_hash VARCHAR(64) NULL`);
      try {
        await pool.execute(`CREATE INDEX idx_transactions_account_receipt_hash ON transactions (account_id, receipt_hash)`);
      } catch (e) {
        if (!e || e.code !== 'ER_DUP_KEYNAME') throw e;
      }
    }

    if (!(await columnExists('user_settings', 'active_account_id'))) {
      await pool.execute(`ALTER TABLE user_settings ADD COLUMN active_account_id INT NULL`);
      try {
        await pool.execute(`CREATE INDEX idx_user_settings_active_account ON user_settings (active_account_id)`);
      } catch (e) {
        if (!e || e.code !== 'ER_DUP_KEYNAME') throw e;
      }
    }
  })();
  return schemaEnsured;
}

async function logAudit(accountId, userId, action, entityType = null, entityId = null, detail = null) {
  await ensureSchema();
  const detailJson = detail ? JSON.stringify(detail) : null;
  await pool.execute(
    `INSERT INTO audit_logs (account_id, user_id, action, entity_type, entity_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [accountId, userId, action, entityType, entityId, detailJson],
  );
}

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

async function ensureUserSettingsRow(userId) {
  const sql = `
    INSERT INTO user_settings (user_id, currency)
    VALUES (?, 'IDR')
    ON DUPLICATE KEY UPDATE user_id = user_id
  `;
  await pool.execute(sql, [userId]);
}

async function getUserMemberships(userId) {
  const sql = `
    SELECT am.account_id, am.role, am.can_write, a.share_token
    FROM account_members am
    JOIN accounts a ON a.id = am.account_id
    WHERE am.user_id = ?
    ORDER BY am.role = 'owner' DESC, am.id ASC
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return rows;
}

async function createAccountAndSetActive(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);

  let token = generateShareToken();
  let accountId = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      const [result] = await pool.execute(`INSERT INTO accounts (share_token) VALUES (?)`, [token]);
      accountId = result.insertId;
      break;
    } catch (e) {
      if (!e || e.code !== 'ER_DUP_ENTRY') throw e;
      token = generateShareToken();
    }
  }
  if (!accountId) {
    throw new Error('Gagal membuat akun baru.');
  }

  await pool.execute(
    `INSERT INTO account_members (user_id, account_id, role, can_write) VALUES (?, ?, 'owner', 1)`,
    [userId, accountId],
  );
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  return { accountId, token };
}

async function getActiveAccountId(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);

  const [settingsRows] = await pool.execute(
    `SELECT active_account_id FROM user_settings WHERE user_id = ?`,
    [userId],
  );
  const activeAccountId = settingsRows[0]?.active_account_id || null;
  if (activeAccountId) return activeAccountId;

  const memberships = await getUserMemberships(userId);
  if (memberships.length > 0) {
    const accountId = memberships[0].account_id;
    await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
      accountId,
      userId,
    ]);
    return accountId;
  }

  const [memberCountRows] = await pool.execute(`SELECT COUNT(*) AS cnt FROM account_members`);
  const hasAnyMember = (memberCountRows[0]?.cnt || 0) > 0;
  const [txCountRows] = await pool.execute(`SELECT COUNT(*) AS cnt FROM transactions`);
  const hasAnyTransaction = (txCountRows[0]?.cnt || 0) > 0;

  if (!hasAnyMember && hasAnyTransaction) {
    const [accountRows] = await pool.execute(`SELECT id FROM accounts WHERE id = 1 LIMIT 1`);
    if (accountRows.length === 0) {
      await pool.execute(`INSERT INTO accounts (id, share_token) VALUES (1, ?)`, [
        generateShareToken(),
      ]);
    }
    await pool.execute(
      `INSERT INTO account_members (user_id, account_id, role, can_write) VALUES (?, 1, 'owner', 1)`,
      [userId],
    );
    await pool.execute(`UPDATE user_settings SET active_account_id = 1 WHERE user_id = ?`, [
      userId,
    ]);
    return 1;
  }

  const created = await createAccountAndSetActive(userId);
  return created.accountId;
}

async function getActiveAccountContext(userId) {
  const accountId = await getActiveAccountId(userId);
  const sql = `
    SELECT role, can_write
    FROM account_members
    WHERE user_id = ? AND account_id = ?
    ORDER BY id DESC
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [userId, accountId]);
  const role = rows[0]?.role || 'viewer';
  const canWrite = !!rows[0]?.can_write;
  return { accountId, role, canWrite };
}

async function getActiveAccountToken(userId) {
  const { accountId, role } = await getActiveAccountContext(userId);
  if (role !== 'owner') {
    throw new Error('Token hanya bisa dilihat oleh pemilik akun.');
  }
  const [rows] = await pool.execute(`SELECT share_token FROM accounts WHERE id = ?`, [accountId]);
  if (rows.length === 0) throw new Error('Akun tidak ditemukan.');
  return { accountId, token: rows[0].share_token };
}

async function rotateActiveAccountToken(userId) {
  const { accountId, role } = await getActiveAccountContext(userId);
  if (role !== 'owner') {
    throw new Error('Token hanya bisa di-reset oleh pemilik akun.');
  }
  const token = generateShareToken();
  await pool.execute(`UPDATE accounts SET share_token = ? WHERE id = ?`, [token, accountId]);
  await logAudit(accountId, userId, 'token_rotate', 'account', String(accountId), {});
  return { accountId, token };
}

async function joinAccountByToken(userId, token) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);

  const [inviteRows] = await pool.execute(
    `SELECT id, account_id, role, can_write
     FROM account_invites
     WHERE invite_token = ?
       AND revoked_at IS NULL
       AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [token],
  );

  if (inviteRows.length > 0) {
    const invite = inviteRows[0];
    const accountId = invite.account_id;
    await pool.execute(
      `INSERT INTO account_members (user_id, account_id, role, can_write)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), can_write = VALUES(can_write)`,
      [userId, accountId, invite.role, invite.can_write],
    );
    await pool.execute(
      `UPDATE account_invites SET used_by_user_id = ?, used_at = NOW() WHERE id = ?`,
      [userId, invite.id],
    );
    await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
      accountId,
      userId,
    ]);
    await logAudit(accountId, userId, 'invite_join', 'invite', String(invite.id), {});
    return { accountId };
  }

  const [rows] = await pool.execute(`SELECT id FROM accounts WHERE share_token = ? LIMIT 1`, [
    token,
  ]);
  if (rows.length === 0) {
    throw new Error('Token tidak ditemukan.');
  }
  const accountId = rows[0].id;

  await pool.execute(
    `INSERT INTO account_members (user_id, account_id, role, can_write)
     VALUES (?, ?, 'viewer', 0)
     ON DUPLICATE KEY UPDATE role = VALUES(role), can_write = VALUES(can_write)`,
    [userId, accountId],
  );
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'token_join', 'account', String(accountId), {});
  return { accountId };
}

async function listUserAccounts(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const memberships = await getUserMemberships(userId);
  const [settingsRows] = await pool.execute(
    `SELECT active_account_id FROM user_settings WHERE user_id = ?`,
    [userId],
  );
  const activeAccountId = settingsRows[0]?.active_account_id || null;
  return memberships.map((m) => ({
    accountId: m.account_id,
    role: m.role,
    canWrite: !!m.can_write,
    isActive: activeAccountId === m.account_id,
  }));
}

async function setActiveAccount(userId, accountId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const [rows] = await pool.execute(
    `SELECT 1 FROM account_members WHERE user_id = ? AND account_id = ? LIMIT 1`,
    [userId, accountId],
  );
  if (rows.length === 0) {
    throw new Error('Kamu tidak punya akses ke akun itu.');
  }
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'account_switch', 'account', String(accountId), {});
  return { accountId };
}

async function switchToOwnedAccount(userId) {
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const [rows] = await pool.execute(
    `SELECT account_id FROM account_members WHERE user_id = ? AND role = 'owner' ORDER BY id ASC LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) {
    const created = await createAccountAndSetActive(userId);
    return { accountId: created.accountId };
  }
  const accountId = rows[0].account_id;
  await pool.execute(`UPDATE user_settings SET active_account_id = ? WHERE user_id = ?`, [
    accountId,
    userId,
  ]);
  await logAudit(accountId, userId, 'account_switch_owned', 'account', String(accountId), {});
  return { accountId };
}

// User settings functions
async function getUserCurrency(userId) {
  console.log(`Getting currency for user ${userId}`);
  await ensureSchema();
  await ensureUserSettingsRow(userId);
  const sql = `SELECT currency FROM user_settings WHERE user_id = ?`;
  const [rows] = await pool.execute(sql, [userId]);
  if (rows.length === 0) {
    return 'IDR'; // default
  }
  return rows[0].currency;
}

async function setUserCurrency(userId, currency) {
  console.log(`Setting currency for user ${userId} to ${currency}`);
  await ensureSchema();
  const sql = `
    INSERT INTO user_settings (user_id, currency)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE currency = ?, updated_at = CURRENT_TIMESTAMP
  `;
  await pool.execute(sql, [userId, currency, currency]);
  const { accountId } = await getActiveAccountContext(userId);
  await logAudit(accountId, userId, 'currency_set', 'user_settings', userId, { currency });
}

/**
 * Inserts a transaction record along with its itemized details into the database.
 * Uses a database transaction to ensure data integrity.
 * @param {object} txData The structured transaction data from the AI.
 */
async function insertTransaction(accountId, txData, actorUserId = null) {
  console.log('Inserting itemized transaction into database:', txData);
  await ensureSchema();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Insert the main transaction record
    const { transaction_date, tipe, nominal, kategori, keterangan, receipt_path, receipt_hash, items, currency = 'IDR' } = txData;
    const mainSql = `
      INSERT INTO transactions (account_id, transaction_date, type, amount, currency, category, description, receipt_path, receipt_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [mainResult] = await connection.execute(mainSql, [accountId, transaction_date, tipe, nominal, currency, kategori, keterangan, receipt_path, receipt_hash || null]);
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
async function getTransactions(accountId, startDate, endDate, targetCurrency = null) {
  console.log(`Fetching transactions from ${startDate} to ${endDate}`);
  await ensureSchema();
  
  // 1. Fetch main transaction records
  const mainSql = `
    SELECT id, transaction_date, type, amount, currency, category, description, receipt_path, receipt_hash
    FROM transactions
    WHERE account_id = ? AND transaction_date >= ? AND transaction_date <= ?
    ORDER BY transaction_date DESC, id DESC
  `;
  const [transactions] = await pool.execute(mainSql, [accountId, startDate, endDate]);

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
async function getLastTransactions(accountId, limit, targetCurrency = null) {
  console.log(`Fetching last ${limit} transactions`);
  await ensureSchema();

  // 1. Fetch main transaction records
  const mainSql = `
    SELECT id, transaction_date, type, amount, currency, category, description, receipt_path, receipt_hash
    FROM transactions
    WHERE account_id = ?
    ORDER BY transaction_date DESC, id DESC
    LIMIT ?
  `;
  const [transactions] = await pool.query(mainSql, [accountId, limit]);

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
async function deleteLastTransaction(accountId, actorUserId = null) {
  await ensureSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Get the last transaction id
    const [rows] = await connection.execute(
      'SELECT id FROM transactions WHERE account_id = ? ORDER BY id DESC LIMIT 1',
      [accountId],
    );
    if (rows.length === 0) {
      throw new Error('No transaction found');
    }
    const transactionId = rows[0].id;
    // Delete the transaction (cascade will delete items)
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
  console.log(`Searching transactions for keyword: ${keyword}`);
  await ensureSchema();
  const searchPattern = `%${keyword}%`;

  // 1. Fetch main transaction records matching keyword in description or item_name
  const mainSql = `
    SELECT DISTINCT t.id, t.transaction_date, t.type, t.amount, t.currency, t.category, t.description, t.receipt_path, t.receipt_hash
    FROM transactions t
    LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
    WHERE t.account_id = ? AND (t.description LIKE ? OR ti.item_name LIKE ?)
    ORDER BY t.transaction_date DESC, t.id DESC
  `;
  const [transactions] = await pool.execute(mainSql, [accountId, searchPattern, searchPattern]);

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

async function updateTransaction(accountId, id, updates, actorUserId = null) {
  console.log(`Updating transaction ${id} with:`, updates);
  await ensureSchema();
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

  values.push(id);
  values.push(accountId);

  const sql = `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ? AND account_id = ?`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(sql, values);
    if (result.affectedRows === 0) {
      throw new Error(`Transaction with ID ${id} not found`);
    }
    await connection.commit();
    console.log(`Transaction ${id} updated successfully.`);
    await logAudit(accountId, actorUserId, 'transaction_update', 'transaction', String(id), updates);
    return id;
  } catch (error) {
    await connection.rollback();
    console.error('Error updating transaction:', error);
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

async function createInvite(accountId, actorUserId, { role = 'viewer', canWrite = 0, expiresDays = null } = {}) {
  await assertOwner(accountId, actorUserId);
  let token = generateShareToken();
  for (let i = 0; i < 3; i += 1) {
    try {
      const [result] = await pool.execute(
        `INSERT INTO account_invites (invite_token, account_id, role, can_write, created_by_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          token,
          accountId,
          role,
          canWrite ? 1 : 0,
          actorUserId,
          expiresDays ? new Date(Date.now() + expiresDays * 86400 * 1000) : null,
        ],
      );
      await logAudit(accountId, actorUserId, 'invite_create', 'invite', String(result.insertId), {
        role,
        can_write: !!canWrite,
        expires_days: expiresDays,
      });
      return { inviteId: result.insertId, token };
    } catch (e) {
      if (!e || e.code !== 'ER_DUP_ENTRY') throw e;
      token = generateShareToken();
    }
  }
  throw new Error('Gagal membuat invite.');
}

async function listInvites(accountId, actorUserId) {
  await assertOwner(accountId, actorUserId);
  const [rows] = await pool.execute(
    `SELECT id, invite_token, role, can_write, created_at, expires_at, used_by_user_id, used_at, revoked_at
     FROM account_invites
     WHERE account_id = ?
     ORDER BY id DESC`,
    [accountId],
  );
  return rows;
}

async function revokeInvite(accountId, actorUserId, inviteId) {
  await assertOwner(accountId, actorUserId);
  await pool.execute(
    `UPDATE account_invites SET revoked_at = NOW() WHERE account_id = ? AND id = ?`,
    [accountId, inviteId],
  );
  await logAudit(accountId, actorUserId, 'invite_revoke', 'invite', String(inviteId), {});
}

async function listMembers(accountId, actorUserId) {
  await assertOwner(accountId, actorUserId);
  const [rows] = await pool.execute(
    `SELECT user_id, role, can_write, created_at
     FROM account_members
     WHERE account_id = ?
     ORDER BY role = 'owner' DESC, created_at ASC`,
    [accountId],
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role,
    can_write: !!r.can_write,
    created_at: r.created_at,
  }));
}

async function revokeMember(accountId, actorUserId, memberUserId) {
  await assertOwner(accountId, actorUserId);
  const member = await getAccountMemberRole(accountId, memberUserId);
  if (!member) throw new Error('Member tidak ditemukan.');
  if (member.role === 'owner') throw new Error('Tidak bisa mencabut owner.');
  await pool.execute(`DELETE FROM account_members WHERE account_id = ? AND user_id = ?`, [
    accountId,
    memberUserId,
  ]);
  await logAudit(accountId, actorUserId, 'member_revoke', 'account_member', memberUserId, {});
}

function monthKeyToRange(monthKey) {
  const [y, m] = monthKey.split('-').map((v) => parseInt(v, 10));
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  return { startDate, endDate };
}

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
  return rows.map((r) => ({
    ...r,
    active: !!r.active,
  }));
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
    await pool.execute(
      `UPDATE recurring_rules SET next_run_date = ? WHERE account_id = ? AND id = ?`,
      [nextRun, accountId, r.id],
    );
    await logAudit(accountId, null, 'recurring_run', 'recurring_rule', String(r.id), { transaction_id: txId });
    created.push({ rule_id: r.id, transaction_id: txId });
  }
  return created;
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
  return txRows.map((t) => ({
    ...t,
    items: itemMap[t.id] || [],
  }));
}

module.exports = {
  ensureSchema,
  getActiveAccountContext,
  getActiveAccountToken,
  rotateActiveAccountToken,
  joinAccountByToken,
  createAccountAndSetActive,
  listUserAccounts,
  setActiveAccount,
  switchToOwnedAccount,
  createInvite,
  listInvites,
  revokeInvite,
  listMembers,
  revokeMember,
  setMonthlyBudget,
  listMonthlyBudgets,
  getSpendingByCategory,
  addRecurringRule,
  listRecurringRules,
  removeRecurringRule,
  runDueRecurring,
  getTransactionsForExport,
  getLastReceiptTransaction,
  findTransactionByReceiptHash,
  insertTransaction,
  getTransactions,
  getLastTransactions,
  deleteLastTransaction,
  searchTransactions,
  updateTransaction,
  getUserCurrency,
  setUserCurrency,
  convertAmount,
};
