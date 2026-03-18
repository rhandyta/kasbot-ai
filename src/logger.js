function nowIso() {
  return new Date().toISOString();
}

function maskSecrets(value) {
  if (value === null || value === undefined) return value;
  const s = typeof value === 'string' ? value : JSON.stringify(value);

  const maskedDigits = s.replace(/\b(\d{6})\d{6,9}(\d{4})\b/g, '$1******$2');
  const maskedTokens = maskedDigits.replace(/\b([A-Za-z0-9_-]{20,})\b/g, (m) => {
    if (m.length <= 24) return `${m.slice(0, 6)}***${m.slice(-4)}`;
    return `${m.slice(0, 8)}***${m.slice(-6)}`;
  });
  return maskedTokens;
}

function log(level, message, fields) {
  const payload = {
    ts: nowIso(),
    level,
    msg: message,
  };
  if (fields && typeof fields === 'object') {
    Object.keys(fields).forEach((k) => {
      payload[k] = fields[k];
    });
  }
  const line = maskSecrets(payload);
  process.stdout.write(`${line}\n`);
}

const logger = {
  info: (message, fields) => log('info', message, fields),
  warn: (message, fields) => log('warn', message, fields),
  error: (message, fields) => log('error', message, fields),
};

module.exports = { logger, maskSecrets };
