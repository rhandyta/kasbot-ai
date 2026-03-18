const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { getUserCurrency, getLastTransactions, getTransactionsForExport } = require('../../db');
const { getDateRange } = require('../utils');
const { maskSecrets } = require('../../logger');

function escapeCsv(value) {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function sendCsvFromTransactions(client, message, senderId, txRows, title) {
  const includeReceipt = String(process.env.EXPORT_INCLUDE_RECEIPT_PATH || 'false').toLowerCase() === 'true';
  const header = ['date', 'type', 'amount', 'currency', 'category', 'merchant', 'description', 'items'];
  if (includeReceipt) header.push('receipt_path');
  const lines = [header.join(',')];
  txRows.forEach((tx) => {
    const items = (tx.items || [])
      .map((it) => `${maskSecrets(it.item_name)} x${it.quantity} @${it.price}`)
      .join(' | ');
    const row = [
      tx.transaction_date,
      tx.type,
      tx.amount,
      tx.currency || 'IDR',
      tx.category,
      tx.merchant || '',
      maskSecrets(tx.description || ''),
      items,
    ];
    if (includeReceipt) row.push(tx.receipt_path || '');
    lines.push(row.map(escapeCsv).join(','));
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

async function sendCsvPerItem(client, message, senderId, txRows, title) {
  const includeReceipt = String(process.env.EXPORT_INCLUDE_RECEIPT_PATH || 'false').toLowerCase() === 'true';
  const header = [
    'transaction_id',
    'date',
    'type',
    'amount',
    'currency',
    'category',
    'merchant',
    'description',
    'item_name',
    'quantity',
    'price',
  ];
  if (includeReceipt) header.push('receipt_path');
  const lines = [header.join(',')];
  txRows.forEach((tx) => {
    const items = tx.items && tx.items.length > 0 ? tx.items : [null];
    items.forEach((it) => {
      const row = [
        tx.id,
        tx.transaction_date,
        tx.type,
        tx.amount,
        tx.currency || 'IDR',
        tx.category,
        tx.merchant || '',
        maskSecrets(tx.description || ''),
        it ? maskSecrets(it.item_name) : '',
        it ? it.quantity : '',
        it ? it.price : '',
      ];
      if (includeReceipt) row.push(tx.receipt_path || '');
      lines.push(row.map(escapeCsv).join(','));
    });
  });
  const csv = lines.join('\n');
  if (csv.length < 55000) {
    await message.reply(`📄 *CSV Export (detail) - ${title}*\n\n${csv}`);
    return;
  }
  const fileName = `export-detail-${Date.now()}.csv`;
  const dir = path.join(__dirname, '..', '..', '..', 'public', 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, csv);
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(senderId, media, { sendMediaAsDocument: true, caption: `CSV Export (detail) - ${title}` });
}

async function handleExport(client, message, senderId, accountId, rawMessageBody) {
  const userCurrency = await getUserCurrency(senderId);
  let arg = rawMessageBody.replace(/^export(\s+csv)?/i, '').trim();
  let mode = 'ringkas';
  if (arg.toLowerCase().startsWith('detail ')) {
    mode = 'detail';
    arg = arg.slice('detail '.length).trim();
  } else if (arg.toLowerCase().startsWith('ringkas ')) {
    mode = 'ringkas';
    arg = arg.slice('ringkas '.length).trim();
  }
  const normalized = arg.toLowerCase();

  if (!arg || normalized === 'bulan ini') {
    const dr = getDateRange('bulan ini');
    const rows = await getTransactionsForExport(accountId, dr.startDate, dr.endDate);
    if (rows.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
    return mode === 'detail'
      ? sendCsvPerItem(client, message, senderId, rows, 'Bulan Ini')
      : sendCsvFromTransactions(client, message, senderId, rows, 'Bulan Ini');
  }

  if (normalized.match(/^(1|10)$/) || normalized.includes('10 transaksi')) {
    const last = await getLastTransactions(accountId, 10, userCurrency);
    if (last.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
    return mode === 'detail'
      ? sendCsvPerItem(client, message, senderId, last, '10 Transaksi Terakhir')
      : sendCsvFromTransactions(client, message, senderId, last, '10 Transaksi Terakhir');
  }

  const rangeMatch = arg.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    const startDate = rangeMatch[1];
    const endDate = rangeMatch[2];
    const rows = await getTransactionsForExport(accountId, startDate, endDate);
    if (rows.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
    const title = `${startDate} s/d ${endDate}`;
    return mode === 'detail'
      ? sendCsvPerItem(client, message, senderId, rows, title)
      : sendCsvFromTransactions(client, message, senderId, rows, title);
  }

  const dr = getDateRange(arg);
  if (!dr.startDate) {
    return message.reply(
      'Periode tidak valid. Contoh: "export bulan ini", "export detail 3 hari terakhir", atau "export 2026-03-01 2026-03-31"',
    );
  }

  const rows = await getTransactionsForExport(accountId, dr.startDate, dr.endDate);
  if (rows.length === 0) return message.reply('Tidak ada transaksi untuk diexport.');
  return mode === 'detail'
    ? sendCsvPerItem(client, message, senderId, rows, dr.periodName)
    : sendCsvFromTransactions(client, message, senderId, rows, dr.periodName);
}

module.exports = { handleExport };
