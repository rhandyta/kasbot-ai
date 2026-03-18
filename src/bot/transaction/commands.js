const {
  deleteLastTransaction,
  restoreLastDeletedTransaction,
  searchTransactions,
  updateTransaction,
  getLastTransactions,
  setUserCurrency,
} = require('../../db');
const { formatMoney } = require('../utils');

async function handleCancelTransaction(message, senderId, accountId) {
  try {
    const deletedId = await deleteLastTransaction(accountId, senderId);
    await message.reply(`✅ Transaksi terakhir (ID: ${deletedId}) berhasil dibatalkan.`);
  } catch (error) {
    console.error('Failed to cancel transaction:', error);
    await message.reply('❌ Gagal membatalkan transaksi. Mungkin tidak ada transaksi yang bisa dibatalkan.');
  }
}

async function handleRestoreLastTransaction(message, senderId, accountId) {
  try {
    const restoredId = await restoreLastDeletedTransaction(accountId, senderId);
    await message.reply(`✅ Transaksi berhasil dikembalikan (ID baru: ${restoredId}).`);
  } catch (error) {
    await message.reply(error.message || 'Gagal mengembalikan transaksi.');
  }
}

async function handleSearch(message, accountId, keyword) {
  if (!keyword.trim()) {
    return message.reply('Masukkan kata kunci pencarian. Contoh: "cari beli ayam"');
  }
  const match = keyword.match(/^(.*?)(?:\s+page\s+(\d+))?$/i);
  const baseKeyword = (match?.[1] || '').trim();
  const page = match?.[2] ? Math.max(parseInt(match[2], 10), 1) : 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  try {
    const transactions = await searchTransactions(accountId, baseKeyword, { limit, offset });
    if (transactions.length === 0) {
      return message.reply(`Tidak ditemukan transaksi dengan kata kunci "${baseKeyword}".`);
    }
    let reply = `🔍 *Hasil pencarian untuk "${baseKeyword}" (page ${page}):*\n\n`;
    transactions.forEach((tx, idx) => {
      const sign = tx.type === 'IN' ? '+' : '-';
      const date = new Date(tx.transaction_date).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
      });
      reply += `*${idx + 1}. ${date}: ${sign}Rp${formatMoney(tx.amount)}* (${tx.category} - ${tx.description || 'N/A'})\n`;
      if (tx.items && tx.items.length > 0) {
        tx.items.forEach((item) => {
          reply += `  - ${item.item_name} (${item.quantity}x) @ Rp${formatMoney(item.price)}\n`;
        });
      }
      reply += '\n';
    });
    if (transactions.length === limit) {
      reply += `Ketik: cari ${baseKeyword} page ${page + 1}\n`;
    }
    await message.reply(reply);
  } catch (error) {
    console.error('Search error:', error);
    await message.reply('Terjadi kesalahan saat mencari transaksi.');
  }
}

async function handleEditTransaction(message, senderId, accountId, messageBody) {
  const parts = messageBody.split(' ');
  const amountIndex = parts.findIndex((p) => p === 'jumlah' || p === 'nominal');
  if (amountIndex === -1) {
    return message.reply('Format edit tidak valid. Contoh: "edit transaksi terakhir jumlah 75000"');
  }
  const amount = parseInt(parts[amountIndex + 1].replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(amount)) {
    return message.reply('Jumlah tidak valid.');
  }
  try {
    const lastTransactions = await getLastTransactions(accountId, 1);
    if (lastTransactions.length === 0) {
      return message.reply('Tidak ada transaksi untuk diedit.');
    }
    const lastId = lastTransactions[0].id;
    await updateTransaction(accountId, lastId, { amount }, senderId);
    await message.reply(`✅ Transaksi terakhir (ID: ${lastId}) berhasil diubah jumlah menjadi Rp${formatMoney(amount)}.`);
  } catch (error) {
    console.error('Edit error:', error);
    await message.reply('Gagal mengedit transaksi.');
  }
}

async function handleSetCurrency(message, senderId, currency) {
  const validCurrencies = ['IDR', 'USD', 'EUR'];
  if (!validCurrencies.includes(currency)) {
    return message.reply(`Mata uang "${currency}" tidak didukung. Gunakan IDR, USD, atau EUR.`);
  }
  try {
    await setUserCurrency(senderId, currency);
    await message.reply(`✅ Mata uang preferensi diatur ke ${currency}. Laporan akan menampilkan jumlah dalam ${currency}.`);
  } catch (error) {
    console.error('Set currency error:', error);
    await message.reply('Gagal menyimpan preferensi mata uang.');
  }
}

module.exports = {
  handleCancelTransaction,
  handleRestoreLastTransaction,
  handleSearch,
  handleEditTransaction,
  handleSetCurrency,
};
