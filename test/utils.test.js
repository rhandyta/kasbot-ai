const test = require('node:test');
const assert = require('node:assert/strict');
const { getDateRange, splitIntoTransactions } = require('../src/bot/utils');

test('getDateRange returns month range for "bulan ini"', () => {
  const r = getDateRange('bulan ini');
  assert.ok(r.startDate);
  assert.ok(r.endDate);
  assert.ok(r.startDate <= r.endDate);
});

test('splitIntoTransactions splits by conjunctions', () => {
  const parts = splitIntoTransactions('beli ayam 50 dan beli susu 20 lalu beli roti 10');
  assert.equal(parts.length, 3);
});

