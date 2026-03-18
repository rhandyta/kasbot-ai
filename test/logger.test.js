const test = require('node:test');
const assert = require('node:assert/strict');
const { maskSecrets } = require('../src/logger');

test('maskSecrets masks long digit sequences', () => {
  const masked = maskSecrets('card 1234567890123456');
  assert.ok(masked.includes('123456******3456'));
});

test('maskSecrets masks long tokens', () => {
  const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGH0123456789_-';
  const masked = maskSecrets(token);
  assert.notEqual(masked, token);
});

