const { ensureSchema } = require('./schema');
const { convertAmount } = require('./currency');
const accounts = require('./accounts');
const transactions = require('./transactions');
const budgets = require('./budgets');
const recurring = require('./recurring');
const userSettings = require('./userSettings');
const categories = require('./categories');
const merchants = require('./merchants');
const dashboard = require('./dashboard');

module.exports = {
  ensureSchema,
  ...accounts,
  ...transactions,
  ...budgets,
  ...recurring,
  ...categories,
  ...merchants,
  ...dashboard,
  ...userSettings,
  convertAmount,
};
