const crypto = require('crypto');
const { recognizeText } = require('../../ocr');
const { structureText } = require('../../ai');
const { saveReceipt } = require('../../file-saver');
const {
  findTransactionByReceiptHash,
  findTransactionByTextHash,
  findTransactionByFingerprint,
  resolveCategoryFromText,
} = require('../../db');
const { splitIntoTransactions, formatDateYyyyMmDd } = require('../utils');
const { setUserState } = require('../state');
const { sendPendingTransactionPreview } = require('./pending');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeTextForHash(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function processTransaction(message, senderId, accountId) {
  let rawText = message.body;
  let mediaFile = null;
  let receiptHash = null;
  let ocrText = '';
  let textHash = null;

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
        ocrText = await recognizeText(media.data);
        rawText = `${rawText} ${ocrText}`;
        const normalizedOcr = normalizeTextForHash(ocrText);
        textHash = normalizedOcr ? sha256Hex(normalizedOcr) : null;
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
    const dupByReceipt = receiptHash ? await findTransactionByReceiptHash(accountId, receiptHash) : null;
    const dupByText = textHash ? await findTransactionByTextHash(accountId, textHash) : null;
    const duplicates = [];
    if (dupByReceipt) duplicates.push({ reason: 'receipt', ...dupByReceipt });
    if (dupByText) duplicates.push({ reason: 'text', ...dupByText });

    for (const part of parts) {
      try {
        const structuredData = await structureText(part);
        if (structuredData.error && structuredData.error === 'Bukan transaksi') {
          continue;
        }
        const resolvedCategory = await resolveCategoryFromText(accountId, structuredData.keterangan || part);
        if (resolvedCategory) {
          structuredData.kategori = resolvedCategory;
        }
        structuredData.receipt_path = receiptPath;
        structuredData.receipt_hash = receiptHash;
        structuredData.text_hash = textHash;
        if (!structuredData.transaction_date) {
          structuredData.transaction_date = formatDateYyyyMmDd(new Date());
        }
        const fingerprintSource = normalizeTextForHash(
          [
            structuredData.transaction_date,
            structuredData.tipe,
            structuredData.nominal,
            structuredData.currency,
            structuredData.kategori,
            structuredData.keterangan,
          ].join('|'),
        );
        structuredData.fingerprint_hash = fingerprintSource ? sha256Hex(fingerprintSource) : null;
        const dupByFingerprint = structuredData.fingerprint_hash
          ? await findTransactionByFingerprint(accountId, structuredData.fingerprint_hash)
          : null;
        structuredData.duplicate = dupByFingerprint ? { reason: 'fingerprint', ...dupByFingerprint } : null;
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
      duplicates,
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
