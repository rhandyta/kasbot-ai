-- Drop tables if they exist to ensure a clean setup
DROP TABLE IF EXISTS deleted_transaction_items;
DROP TABLE IF EXISTS deleted_transactions;
DROP TABLE IF EXISTS budget_notifications;
DROP TABLE IF EXISTS summary_notifications;
DROP TABLE IF EXISTS merchant_normalization_rules;
DROP TABLE IF EXISTS merchant_category_rules;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS transaction_items;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS recurring_rules;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS account_invites;
DROP TABLE IF EXISTS account_members;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS user_settings;

CREATE TABLE accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    share_token VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    account_id INT NOT NULL,
    role ENUM('owner', 'viewer') NOT NULL DEFAULT 'viewer',
    can_write TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_account (user_id, account_id),
    INDEX idx_account_members_user (user_id),
    INDEX idx_account_members_account (account_id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Create the main transactions table
CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    account_id INT NOT NULL DEFAULT 1,
    transaction_date DATE NOT NULL,
    type ENUM('IN', 'OUT') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL, -- This is the total amount
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
    INDEX idx_transactions_account_fingerprint_hash (account_id, fingerprint_hash),
    INDEX idx_transactions_account_merchant (account_id, merchant)
);

-- Create the table for itemized details of a transaction
CREATE TABLE transaction_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    price DECIMAL(15, 2) NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    INDEX idx_transaction_items_tx (transaction_id),
    INDEX idx_transaction_items_name (item_name)
);

-- Create user settings table for currency preferences
CREATE TABLE user_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL UNIQUE,
    currency CHAR(3) DEFAULT 'IDR',
    active_account_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_settings_active_account (active_account_id)
);

CREATE TABLE account_invites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invite_token VARCHAR(64) NOT NULL UNIQUE,
    account_id INT NOT NULL,
    role ENUM('owner', 'viewer') NOT NULL DEFAULT 'viewer',
    can_write TINYINT(1) NOT NULL DEFAULT 0,
    created_by_user_id VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    used_by_user_id VARCHAR(255) NULL,
    used_at TIMESTAMP NULL,
    revoked_at TIMESTAMP NULL,
    INDEX idx_account_invites_account (account_id)
);

CREATE TABLE audit_logs (
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
);

CREATE TABLE budgets (
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
);

CREATE TABLE recurring_rules (
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
);

CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_category (account_id, name),
    INDEX idx_categories_account (account_id)
);

CREATE TABLE merchant_category_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    category_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_rule (account_id, keyword),
    INDEX idx_rules_account (account_id)
);

CREATE TABLE merchant_normalization_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    merchant_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_merchant_rule (account_id, keyword),
    INDEX idx_merchant_rules_account (account_id)
);

CREATE TABLE summary_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    kind VARCHAR(32) NOT NULL,
    period_key VARCHAR(32) NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_summary_notif (account_id, kind, period_key),
    INDEX idx_summary_notif_account (account_id)
);

CREATE TABLE budget_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    month_key CHAR(7) NOT NULL,
    category VARCHAR(255) NOT NULL,
    level INT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_budget_notif (account_id, month_key, category, level),
    INDEX idx_budget_notif_account (account_id)
);

CREATE TABLE deleted_transactions (
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
);

CREATE TABLE deleted_transaction_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    deleted_transaction_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    price DECIMAL(15, 2) NOT NULL,
    INDEX idx_deleted_items_deleted_tx (deleted_transaction_id)
);
