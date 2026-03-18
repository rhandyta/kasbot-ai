const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStatementCsv } = require('../src/import/csv');

test('parseStatementCsv parses minimal csv', () => {
  const csv = `date,amount,description\n2026-03-01,12000,Grab Food\n2026-03-02,-5000,Parkir\n`;
  const txs = parseStatementCsv(csv);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].transaction_date, '2026-03-01');
  assert.equal(txs[0].nominal, 12000);
  assert.equal(txs[1].tipe, 'OUT');
  assert.ok(typeof txs[0].fingerprint_hash === 'string' && txs[0].fingerprint_hash.length > 0);
});
