const { getUserCurrency, getTransactions, getLastTransactions } = require('../db');
const { getDateRange, formatMoney } = require('./utils');
const { setUserState, clearUserState, getUserState } = require('./state');

async function startReportFlow(client, senderId) {
  setUserState(senderId, { step: 'awaiting_report_period' });
  const reply = `Pilih periode laporan yang diinginkan:
1. 10 Transaksi Terakhir
2. Hari ini
3. 3 Hari Terakhir
4. Minggu ini
5. 2 Minggu Terakhir
6. Bulan ini
7. 3 Bulan Terakhir
8. 6 Bulan Terakhir
9. Tahun ini`;
  await client.sendMessage(senderId, reply);
}

function presentReport(message, senderId, transactions, periodName) {
  let totalIn = 0;
  let totalOut = 0;
  transactions.forEach((tx) => {
    if (tx.type === 'IN') totalIn += parseFloat(tx.amount);
    if (tx.type === 'OUT') totalOut += parseFloat(tx.amount);
  });

  const summaryMessage = `📊 *Laporan Keuangan - ${periodName}*

💰 *Pemasukan:* Rp${formatMoney(totalIn)}
💸 *Pengeluaran:* Rp${formatMoney(totalOut)}
---------------------
📈 *Bersih:* Rp${formatMoney(totalIn - totalOut)}

Balas "detail" untuk melihat rincian transaksi.`;

  message.reply(summaryMessage);
  setUserState(senderId, { step: 'awaiting_detail_request', transactions, pageSize: 15 });
}

async function handleDetailRequest(message, senderId, messageBody) {
  const state = getUserState(senderId);
  const transactions = state?.transactions || [];
  const pageSize = state?.pageSize || 15;
  const match = (messageBody || '').match(/^detail(?:\s+(\d+))?$/i);
  const page = match?.[1] ? Math.max(parseInt(match[1], 10), 1) : 1;
  const offset = (page - 1) * pageSize;
  const pageItems = transactions.slice(offset, offset + pageSize);
  if (pageItems.length === 0) {
    await message.reply('Tidak ada transaksi di halaman itu.');
    return;
  }
  let detailMessage = '📜 *Rincian Transaksi*\n\n';

  pageItems.forEach((tx) => {
    const sign = tx.type === 'IN' ? '+' : '-';
    const date = new Date(tx.transaction_date).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
    });
    const amount = formatMoney(tx.amount);
    detailMessage += `*${date}: ${sign}Rp${amount}* (${tx.category} - ${tx.description || 'N/A'})\n`;
    if (tx.items && tx.items.length > 0) {
      tx.items.forEach((item) => {
        detailMessage += `  - ${item.item_name} (${item.quantity}x) @ Rp${formatMoney(item.price)}\n`;
      });
    }
    detailMessage += '\n';
  });

  if (offset + pageSize < transactions.length) {
    detailMessage += `Halaman berikutnya: detail ${page + 1}\n`;
  } else {
    clearUserState(senderId);
  }
  message.reply(detailMessage);
}

async function handleReportPeriodSelection(message, senderId, accountId, choice) {
  const userCurrency = await getUserCurrency(senderId);
  const normalizedChoice = choice.replace(/\./g, '').trim();

  if (normalizedChoice.match(/^(1|10)$/) || choice.match(/10 (transaksi )?terakhir/)) {
    try {
      const transactions = await getLastTransactions(accountId, 10, userCurrency);
      if (transactions.length === 0) {
        clearUserState(senderId);
        return message.reply('Tidak ada transaksi yang ditemukan.');
      }
      return presentReport(message, senderId, transactions, '10 Transaksi Terakhir');
    } catch (error) {
      console.error(error);
      clearUserState(senderId);
      return message.reply('Maaf, terjadi kesalahan saat mengambil laporan.');
    }
  }

  const { startDate, endDate, periodName } = getDateRange(normalizedChoice);
  if (!startDate) {
    clearUserState(senderId);
    return message.reply('Pilihan tidak valid. Silakan mulai lagi dengan mengirim "laporan".');
  }

  try {
    const transactions = await getTransactions(accountId, startDate, endDate, userCurrency);
    if (transactions.length === 0) {
      clearUserState(senderId);
      return message.reply(`Tidak ada transaksi yang ditemukan untuk periode "${periodName}".`);
    }
    presentReport(message, senderId, transactions, periodName);
  } catch (error) {
    console.error(error);
    clearUserState(senderId);
    message.reply('Maaf, terjadi kesalahan saat mengambil laporan.');
  }
}

async function handleStatefulMessage(message, senderId, messageBody, accountId) {
  const currentState = getUserState(senderId);
  if (!currentState) return false;

  if (currentState.step === 'awaiting_report_period') {
    await handleReportPeriodSelection(message, senderId, accountId, messageBody);
    return true;
  }

  if (currentState.step === 'awaiting_detail_request' && messageBody.startsWith('detail')) {
    await handleDetailRequest(message, senderId, messageBody);
    return true;
  }

  clearUserState(senderId);
  await message.reply(
    'Perintah tidak dikenali. Kembali ke mode normal. Kirim "laporan" untuk memulai lagi.',
  );
  return true;
}

module.exports = { startReportFlow, handleStatefulMessage };
