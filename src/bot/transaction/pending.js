const { insertTransaction } = require('../../db');
const { formatMoney } = require('../utils');
const { getUserState, clearUserState } = require('../state');

async function sendPendingTransactionPreview(message, senderId, state) {
  let txt = `🧾 *Preview transaksi (${state.transactions.length})*\n\n`;
  if (state.duplicate) {
    txt += `⚠️ Kemungkinan duplikat: sudah ada transaksi ID ${state.duplicate.id} (${state.duplicate.transaction_date})\n\n`;
  }
  state.transactions.forEach((tx, idx) => {
    txt += `*Transaksi ${idx + 1}:*\n`;
    txt += `- Tipe: ${tx.tipe}\n`;
    txt += `- Tanggal: ${tx.transaction_date}\n`;
    txt += `- Total: Rp${formatMoney(tx.nominal)}\n`;
    txt += `- Kategori: ${tx.kategori}\n`;
    txt += `- Keterangan: ${tx.keterangan}\n`;
    if (tx.items && tx.items.length > 0) {
      const itemNames = tx.items.map((it) => `${it.item_name} (${it.quantity}x)`).join(', ');
      txt += `- Items: ${itemNames}\n`;
    }
    txt += '\n';
  });
  txt += `Balas:\n- ok\n- batal\n- lihat\n- ubah transaksi <n> jumlah <angka>\n- ubah transaksi <n> kategori <teks>\n- ubah transaksi <n> keterangan <teks>\n- ubah transaksi <n> tanggal YYYY-MM-DD`;
  await message.reply(txt);
}

async function handlePendingTransactionMessage(message, senderId, messageBody, rawMessageBody) {
  const state = getUserState(senderId);
  if (!state || state.step !== 'awaiting_tx_confirmation') return false;

  if (messageBody === 'lihat') {
    await sendPendingTransactionPreview(message, senderId, state);
    return true;
  }

  if (messageBody === 'batal' || messageBody === 'batalkan' || messageBody === 'cancel') {
    clearUserState(senderId);
    await message.reply('✅ Dibatalin. Tidak ada transaksi yang disimpan.');
    return true;
  }

  if (messageBody === 'ok' || messageBody === 'ya' || messageBody === 'simpan') {
    try {
      for (const tx of state.transactions) {
        await insertTransaction(state.accountId, tx, senderId);
      }
      clearUserState(senderId);
      await message.reply(`✅ Disimpan ${state.transactions.length} transaksi.`);
    } catch {
      await message.reply('❌ Gagal menyimpan transaksi.');
    }
    return true;
  }

  const match = rawMessageBody.match(
    /^ubah transaksi\s+(\d+)\s+(jumlah|kategori|keterangan|tanggal)\s+(.+)$/i,
  );
  if (!match) {
    await message.reply('Perintah tidak dikenali. Balas "lihat" untuk lihat preview.');
    return true;
  }

  const index = parseInt(match[1], 10);
  const field = match[2].toLowerCase();
  const value = match[3].trim();
  if (!Number.isFinite(index) || index < 1 || index > state.transactions.length) {
    await message.reply('Nomor transaksi tidak valid.');
    return true;
  }

  const tx = state.transactions[index - 1];
  if (field === 'jumlah') {
    const amount = parseInt(value.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(amount)) {
      await message.reply('Jumlah tidak valid.');
      return true;
    }
    tx.nominal = amount;
  } else if (field === 'kategori') {
    tx.kategori = value;
  } else if (field === 'keterangan') {
    tx.keterangan = value;
  } else if (field === 'tanggal') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      await message.reply('Format tanggal harus YYYY-MM-DD.');
      return true;
    }
    tx.transaction_date = value;
  }

  await sendPendingTransactionPreview(message, senderId, state);
  return true;
}

module.exports = { handlePendingTransactionMessage, sendPendingTransactionPreview };
