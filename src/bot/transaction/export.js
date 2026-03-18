const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { getUserCurrency, getLastTransactions, getTransactionsForExport } = require('../../db');
const { getDateRange } = require('../utils');

function escapeCsv(value) {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function sendCsvFromTransactions(client, message, senderId, txRows, title) {
  const header = ['date', 'type', 'amount', 'currency', 'category', 'description', 'items', 'receipt_path'];
  const lines = [header.join(',')];
  txRows.forEach((tx) => {
    const items = (tx.items || [])
      .map((it) => `${it.item_name} x${it.quantity} @${it.price}`)
      .join(' | ');
    const row = [
      tx.transaction_date,
      tx.type,
      tx.amount,
      tx.currency || 'IDR',
      tx.category,
      tx.description || '',
      items,
      tx.receipt_path || '',
    ].map(escapeCsv);
    lines.push(row.join(','));
  });
  const csv = lines.join('\n');
  if (csv.length < 55000) {
    await message.reply(`📄 *CSV Export - ${title}*\n\n${csv}`);
    return;
  }

  const fileName = `export-${Date.now()}.csv`;
  const dir = path.join(__dirname, '..', '..', '..', 'public', 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, csv);
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(senderId, media, { sendMediaAsDocument: true, caption: `CSV Export - ${title}` });
}

async function handleExport(client, message, senderId, accountId, rawMessageBody) {
  const userCurrency = await getUserCurrency(senderId);
  const arg = rawMessageBody.replace(/^export(\s+csv)?/i, '').trim();
  const normalized = arg.toLowerCase();

  if (!arg || normalized === 'bulan ini') {
    const dr = getDateRange('bulan ini');
    const rows = await getTransactionsForExport(accountId, dr.startDate, dr.endDate);
    if (rows.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
    return sendCsvFromTransactions(client, message, senderId, rows, 'Bulan Ini');
  }

  if (normalized.match(/^(1|10)$/) || normalized.includes('10 transaksi')) {
    const last = await getLastTransactions(accountId, 10, userCurrency);
    if (last.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
    return sendCsvFromTransactions(client, message, senderId, last, '10 Transaksi Terakhir');
  }

  const dr = getDateRange(arg);
  if (!dr.startDate) {
    return message.reply('Periode tidak valid. Contoh: "export bulan ini" atau "export 3 hari terakhir"');
  }

  const rows = await getTransactionsForExport(accountId, dr.startDate, dr.endDate);
  if (rows.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
  return sendCsvFromTransactions(client, message, senderId, rows, dr.periodName);
}

module.exports = { handleExport };
