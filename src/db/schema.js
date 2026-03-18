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
    const tryCreateIndex = async (sql) => {
      try {
        await pool.execute(sql);
      } catch (e) {
        if (!e || e.code !== 'ER_DUP_KEYNAME') throw e;
      }
    };

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
        merchant VARCHAR(255) NULL,
        description TEXT,
        receipt_path VARCHAR(255),
        receipt_hash VARCHAR(64) NULL,
        text_hash VARCHAR(64) NULL,
        fingerprint_hash VARCHAR(64) NULL,
        INDEX idx_transactions_account_date (account_id, transaction_date),
        INDEX idx_transactions_account_receipt_hash (account_id, receipt_hash),
        INDEX idx_transactions_account_text_hash (account_id, text_hash),
        INDEX idx_transactions_account_fingerprint_hash (account_id, fingerprint_hash)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS transaction_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        price DECIMAL(15, 2) NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        INDEX idx_transaction_items_tx (transaction_id),
        INDEX idx_transaction_items_name (item_name)
      )
    `);

    await tryCreateIndex(`CREATE INDEX idx_transaction_items_tx ON transaction_items (transaction_id)`);
    await tryCreateIndex(`CREATE INDEX idx_transaction_items_name ON transaction_items (item_name)`);

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

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_category (account_id, name),
        INDEX idx_categories_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS merchant_category_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        category_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rule (account_id, keyword),
        INDEX idx_rules_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS merchant_normalization_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        merchant_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_merchant_rule (account_id, keyword),
        INDEX idx_merchant_rules_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS summary_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        kind VARCHAR(32) NOT NULL,
        period_key VARCHAR(32) NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_summary_notif (account_id, kind, period_key),
        INDEX idx_summary_notif_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS budget_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        month_key CHAR(7) NOT NULL,
        category VARCHAR(255) NOT NULL,
        level INT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_budget_notif (account_id, month_key, category, level),
        INDEX idx_budget_notif_account (account_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS deleted_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        original_transaction_id INT NOT NULL,
        account_id INT NOT NULL,
        deleted_by_user_id VARCHAR(255) NULL,
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transaction_date DATE NOT NULL,
        type ENUM('IN', 'OUT') NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        currency CHAR(3) DEFAULT 'IDR',
        category VARCHAR(255) NOT NULL,
        merchant VARCHAR(255) NULL,
        description TEXT,
        receipt_path VARCHAR(255),
        receipt_hash VARCHAR(64) NULL,
        text_hash VARCHAR(64) NULL,
        fingerprint_hash VARCHAR(64) NULL,
        UNIQUE KEY uniq_deleted_original (account_id, original_transaction_id),
        INDEX idx_deleted_account (account_id),
        INDEX idx_deleted_deleted_at (deleted_at)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS deleted_transaction_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deleted_transaction_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        price DECIMAL(15, 2) NOT NULL,
        INDEX idx_deleted_items_deleted_tx (deleted_transaction_id)
      )
    `);

    if (!(await columnExists('transactions', 'account_id'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN account_id INT NOT NULL DEFAULT 1`);
    }

    if (!(await columnExists('transactions', 'receipt_hash'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN receipt_hash VARCHAR(64) NULL`);
    }

    if (!(await columnExists('transactions', 'merchant'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN merchant VARCHAR(255) NULL`);
      await tryCreateIndex(`CREATE INDEX idx_transactions_account_merchant ON transactions (account_id, merchant)`);
    }

    if (!(await columnExists('transactions', 'text_hash'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN text_hash VARCHAR(64) NULL`);
      await tryCreateIndex(
        `CREATE INDEX idx_transactions_account_text_hash ON transactions (account_id, text_hash)`,
      );
    }

    if (!(await columnExists('transactions', 'fingerprint_hash'))) {
      await pool.execute(`ALTER TABLE transactions ADD COLUMN fingerprint_hash VARCHAR(64) NULL`);
      await tryCreateIndex(
        `CREATE INDEX idx_transactions_account_fingerprint_hash ON transactions (account_id, fingerprint_hash)`,
      );
    }

    if (!(await columnExists('deleted_transactions', 'merchant'))) {
      await pool.execute(`ALTER TABLE deleted_transactions ADD COLUMN merchant VARCHAR(255) NULL`);
      await tryCreateIndex(
        `CREATE INDEX idx_deleted_transactions_account_merchant ON deleted_transactions (account_id, merchant)`,
      );
    }

    if (!(await columnExists('deleted_transactions', 'text_hash'))) {
      await pool.execute(`ALTER TABLE deleted_transactions ADD COLUMN text_hash VARCHAR(64) NULL`);
    }

    if (!(await columnExists('deleted_transactions', 'fingerprint_hash'))) {
      await pool.execute(`ALTER TABLE deleted_transactions ADD COLUMN fingerprint_hash VARCHAR(64) NULL`);
    }

    if (!(await columnExists('user_settings', 'active_account_id'))) {
      await pool.execute(`ALTER TABLE user_settings ADD COLUMN active_account_id INT NULL`);
    }

    await pool.execute(
      `INSERT IGNORE INTO schema_migrations (id) VALUES (?)`,
      ['bootstrap_2026_03_19'],
    );
  })();
  return schemaEnsured;
}

module.exports = { ensureSchema };
