const { pool } = require('./pool');
const { ensureSchema } = require('./schema');

const REQUIRED = {
  tables: [
    'accounts',
    'account_members',
    'account_invites',
    'user_settings',
    'transactions',
    'transaction_items',
    'audit_logs',
    'budgets',
    'recurring_rules',
    'categories',
    'merchant_category_rules',
    'merchant_normalization_rules',
    'summary_notifications',
    'budget_notifications',
    'deleted_transactions',
    'deleted_transaction_items',
  ],
  columns: {
    transactions: [
      'account_id',
      'transaction_date',
      'type',
      'amount',
      'currency',
      'category',
      'merchant',
      'description',
      'receipt_path',
      'receipt_hash',
      'text_hash',
      'fingerprint_hash',
      'created_at',
    ],
    deleted_transactions: [
      'account_id',
      'original_transaction_id',
      'deleted_at',
      'transaction_date',
      'type',
      'amount',
      'currency',
      'category',
      'merchant',
      'description',
      'receipt_path',
      'receipt_hash',
      'text_hash',
      'fingerprint_hash',
    ],
    transaction_items: ['transaction_id', 'item_name', 'quantity', 'price'],
  },
};

async function getCurrentDbName() {
  const [rows] = await pool.execute('SELECT DATABASE() AS db');
  return rows[0]?.db || null;
}

async function listTables(schemaName) {
  const [rows] = await pool.execute(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?`,
    [schemaName],
  );
  return rows.map((r) => r.name);
}

async function listColumns(schemaName, tableName) {
  const [rows] = await pool.execute(
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
    [schemaName, tableName],
  );
  return rows.map((r) => r.name);
}

async function checkSchema() {
  await ensureSchema();
  const schemaName = await getCurrentDbName();
  if (!schemaName) return { ok: false, error: 'db_not_selected' };

  const existingTables = await listTables(schemaName);
  const missingTables = REQUIRED.tables.filter((t) => !existingTables.includes(t));

  const missingColumns = {};
  for (const [table, cols] of Object.entries(REQUIRED.columns)) {
    if (!existingTables.includes(table)) continue;
    const existingCols = await listColumns(schemaName, table);
    const missing = cols.filter((c) => !existingCols.includes(c));
    if (missing.length > 0) missingColumns[table] = missing;
  }

  const ok = missingTables.length === 0 && Object.keys(missingColumns).length === 0;
  return { ok, missingTables, missingColumns };
}

module.exports = { checkSchema };
