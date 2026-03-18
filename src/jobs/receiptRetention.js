const fs = require('fs');
const path = require('path');
const { detachOldReceipts } = require('../db');
const { logger } = require('../logger');

function safeResolvePublicPath(receiptPath) {
  const relative = String(receiptPath || '').startsWith('/')
    ? String(receiptPath).slice(1)
    : String(receiptPath || '');
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const full = path.normalize(path.join(publicDir, relative));
  if (!full.startsWith(publicDir)) return null;
  return full;
}

async function runReceiptRetention() {
  const rawDays = process.env.RECEIPT_RETENTION_DAYS;
  if (rawDays === undefined || rawDays === null || String(rawDays).trim() === '') {
    return { deleted: 0, skipped: true };
  }
  const days = Math.max(parseInt(rawDays, 10) || 0, 1);
  const rows = await detachOldReceipts(days);
  if (rows.length === 0) return { deleted: 0 };

  let deleted = 0;
  rows.forEach((r) => {
    const full = safeResolvePublicPath(r.receipt_path);
    if (!full) return;
    if (!fs.existsSync(full)) return;
    try {
      fs.unlinkSync(full);
      deleted += 1;
    } catch {}
  });

  logger.info('receipt_retention', { days, detached: rows.length, deleted });
  return { deleted };
}

module.exports = { runReceiptRetention };
