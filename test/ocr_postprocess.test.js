const test = require('node:test');
const assert = require('node:assert/strict');
const { postProcessOcrText } = require('../src/ocr/postprocess');

test('postProcessOcrText fixes common lookalikes examples', () => {
  const input = [
    '01g Cola',
    'IANGJ',
    'Kissin',
    '7OOGR',
  ].join('\n');
  const out = postProcessOcrText(input);
  assert.ok(out.includes('BIG COLA'));
  assert.ok(out.includes('TANGO'));
  assert.ok(out.includes('NISSIN'));
  assert.ok(out.includes('700GR'));
});

