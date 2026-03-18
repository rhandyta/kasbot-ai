-- Drop tables if they exist to ensure a clean setup
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
    description TEXT,
    receipt_path VARCHAR(255),
    receipt_hash VARCHAR(64) NULL,
    INDEX idx_transactions_account_date (account_id, transaction_date),
    INDEX idx_transactions_account_receipt_hash (account_id, receipt_hash)
);

-- Create the table for itemized details of a transaction
CREATE TABLE transaction_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    price DECIMAL(15, 2) NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
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
