const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { getLastReceiptTransaction } = require('../../db');
const { logAudit } = require('../../db/audit');

async function handleLastReceipt(client, message, senderId, accountId) {
  const last = await getLastReceiptTransaction(accountId);
  if (!last || !last.receipt_path) {
    await message.reply('Tidak ada struk yang tersimpan.');
    return;
  }

  const relative = last.receipt_path.startsWith('/') ? last.receipt_path.slice(1) : last.receipt_path;
  const filePath = path.join(__dirname, '..', '..', '..', 'public', relative);
  if (!fs.existsSync(filePath)) {
    await message.reply('File struk tidak ditemukan di server.');
    return;
  }

  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(senderId, media, { sendMediaAsDocument: true, caption: `Struk transaksi ID ${last.id}` });
  await logAudit(accountId, senderId, 'receipt_download_last', 'transaction', String(last.id), {});
}

module.exports = { handleLastReceipt };
