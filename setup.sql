-- Drop tables if they exist to ensure a clean setup
DROP TABLE IF EXISTS transaction_items;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS user_settings;

-- Create the main transactions table
CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    transaction_date DATE NOT NULL,
    type ENUM('IN', 'OUT') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL, -- This is the total amount
    currency CHAR(3) DEFAULT 'IDR',
    category VARCHAR(255) NOT NULL,
    description TEXT,
    receipt_path VARCHAR(255)
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
