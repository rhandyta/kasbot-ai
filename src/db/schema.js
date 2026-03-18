const { pool } = require('./pool');

let schemaEnsured = null;

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
        receipt_hash VARCHAR(64) NULL,
        INDEX idx_transactions_account_date (account_id, transaction_date),
        INDEX idx_transactions_account_receipt_hash (account_id, receipt_hash)
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
    }

    if (!(await columnExists('transactions', 'receipt_hash'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN receipt_hash VARCHAR(64) NULL`);
    }

    if (!(await columnExists('user_settings', 'active_account_id'))) {
      await pool.execute(`ALTER TABLE user_settings ADD COLUMN active_account_id INT NULL`);
    }
  })();
  return schemaEnsured;
}

module.exports = { ensureSchema };
