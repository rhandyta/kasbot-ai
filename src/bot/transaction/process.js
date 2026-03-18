const crypto = require('crypto');
const { recognizeText } = require('../../ocr');
const { structureText } = require('../../ai');
const { saveReceipt } = require('../../file-saver');
const { findTransactionByReceiptHash } = require('../../db');
const { splitIntoTransactions } = require('../utils');
const { setUserState } = require('../state');
const { sendPendingTransactionPreview } = require('./pending');

async function processTransaction(message, senderId, accountId) {
  let rawText = message.body;
  let mediaFile = null;
  let receiptHash = null;

  if (message.hasMedia) {
    const media = await message.downloadMedia();
    if (media && media.mimetype.startsWith('image/')) {
      mediaFile = media;
      try {
        const buffer = Buffer.from(media.data, 'base64');
        receiptHash = crypto.createHash('sha256').update(buffer).digest('hex');
      } catch {
        receiptHash = null;
      }
      try {
        const ocrText = await recognizeText(media.data);
        rawText = `${rawText} ${ocrText}`;
      } catch {
        return message.reply('Maaf, gagal memproses gambar.');
      }
    }
  }

  if (rawText.trim().length === 0) {
    if (mediaFile) {
      return message.reply(
        'Maaf, tidak ada teks yang bisa dibaca dari gambar tersebut. Coba foto dengan lebih jelas.',
      );
    }
    return;
  }

  try {
    const parts = splitIntoTransactions(rawText);
    const transactions = [];
    const receiptPath = mediaFile ? await saveReceipt(mediaFile) : null;
    const dup = receiptHash ? await findTransactionByReceiptHash(accountId, receiptHash) : null;

    for (const part of parts) {
      try {
        const structuredData = await structureText(part);
        if (structuredData.error && structuredData.error === 'Bukan transaksi') {
          continue;
        }
        structuredData.receipt_path = receiptPath;
        structuredData.receipt_hash = receiptHash;
        if (!structuredData.transaction_date) {
          structuredData.transaction_date = new Date().toISOString().slice(0, 10);
        }
        transactions.push(structuredData);
      } catch (error) {
        console.error(`Failed to process part: "${part}"`, error);
      }
    }

    if (transactions.length === 0) {
      return message.reply('Tidak ada transaksi yang bisa dicatat dari pesan ini.');
    }

    const state = {
      step: 'awaiting_tx_confirmation',
      accountId,
      receiptPath,
      receiptHash,
      duplicate: dup,
      transactions,
    };
    setUserState(senderId, state);
    await sendPendingTransactionPreview(message, senderId, state);
  } catch (error) {
    console.error('Full error trace:', error);
    message.reply('Waduh, AI-nya lagi pusing, atau formatnya aneh. Gagal mencatat transaksi.');
  }
}

module.exports = { processTransaction };
