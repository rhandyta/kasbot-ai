const {
  insertTransaction,
  getUserCurrency,
  listCategories,
  listMonthlyBudgets,
  getSpendingByCategory,
  tryMarkBudgetNotification,
  convertAmount,
} = require('../../db');
const { formatMoney } = require('../utils');
const { getUserState, clearUserState } = require('../state');
const { createButtons, createList } = require('../interactive');

function validateTransaction(tx) {
  const errors = [];
  const warnings = [];
  const nominal = Number(tx.nominal);
  if (!Number.isFinite(nominal) || nominal <= 0) {
    errors.push('Nominal harus > 0');
  } else if (nominal > 1_000_000_000) {
    warnings.push('Nominal sangat besar');
  }

  if (tx.items && tx.items.length > 0) {
    let sum = 0;
    tx.items.forEach((it, idx) => {
      const q = Number(it.quantity);
      const p = Number(it.price);
      if (!Number.isFinite(q) || q <= 0) errors.push(`Item ${idx + 1}: qty invalid`);
      if (!Number.isFinite(p) || p <= 0) errors.push(`Item ${idx + 1}: harga invalid`);
      if (Number.isFinite(q) && Number.isFinite(p)) sum += q * p;
    });
    if (Number.isFinite(nominal) && nominal > 0 && sum > 0) {
      const diffPct = Math.abs(sum - nominal) / nominal;
      if (diffPct >= 0.15) {
        warnings.push('Total item jauh dari nominal');
      }
    }
  }
  return { errors, warnings };
}

async function sendPendingTransactionPreview(message, senderId, state) {
  let txt = `🧾 *Preview transaksi (${state.transactions.length})*\n\n`;
  if (state.duplicates && state.duplicates.length > 0) {
    const lines = state.duplicates.map((d) => `- ${d.reason}: ID ${d.id} (${d.transaction_date})`).join('\n');
    txt += `⚠️ Kemungkinan duplikat:\n${lines}\n\n`;
  }
  state.transactions.forEach((tx, idx) => {
    const v = validateTransaction(tx);
    txt += `*Transaksi ${idx + 1}:*\n`;
    txt += `- Tipe: ${tx.tipe}\n`;
    txt += `- Tanggal: ${tx.transaction_date}\n`;
    txt += `- Total: Rp${formatMoney(tx.nominal)}\n`;
    txt += `- Kategori: ${tx.kategori}\n`;
    txt += `- Keterangan: ${tx.keterangan}\n`;
    if (tx.duplicate) {
      txt += `- ⚠️ Duplikat: ${tx.duplicate.reason} ID ${tx.duplicate.id} (${tx.duplicate.transaction_date})\n`;
    }
    if (tx.items && tx.items.length > 0) {
      txt += `- Items:\n`;
      tx.items.forEach((it, itemIdx) => {
        txt += `  ${itemIdx + 1}. ${it.item_name} (${it.quantity}x) @ Rp${formatMoney(it.price)}\n`;
      });
    }
    if (v.errors.length > 0) {
      txt += `- ❌ Perlu diperbaiki: ${v.errors.join(', ')}\n`;
    } else if (v.warnings.length > 0) {
      txt += `- ⚠️ Warning: ${v.warnings.join(', ')}\n`;
    }
    txt += '\n';
  });
  txt += `Pilih tombol atau balas:\n- ok\n- ok paksa\n- batal\n- lihat\n- ubah transaksi <n> jumlah <angka>\n- ubah transaksi <n> kategori <teks>\n- ubah transaksi <n> keterangan <teks>\n- ubah transaksi <n> tanggal YYYY-MM-DD\n- ubah transaksi <n> item tambah <nama> <qty> <harga>\n- ubah transaksi <n> item hapus <no>\n- ubah transaksi <n> item ubah <no> <qty> <harga>`;
  await message.reply(txt);

  const buttons = createButtons(
    'Aksi cepat:',
    [
      { id: 'tx_ok', body: 'OK' },
      { id: 'tx_cancel', body: 'Batal' },
      { id: 'tx_show', body: 'Lihat' },
    ],
    '',
    '',
  );
  if (buttons) {
    await message.reply(buttons);
  }
}

async function handlePendingTransactionMessage(message, senderId, messageBody, rawMessageBody) {
  const state = getUserState(senderId);
  if (!state || state.step !== 'awaiting_tx_confirmation') return false;

  if (messageBody === 'tx_ok') {
    messageBody = 'ok';
    rawMessageBody = 'ok';
  } else if (messageBody === 'tx_cancel') {
    messageBody = 'batal';
    rawMessageBody = 'batal';
  } else if (messageBody === 'tx_show') {
    messageBody = 'lihat';
    rawMessageBody = 'lihat';
  }

  const catPickMatch = messageBody.match(/^txcat_(\d+)_(\d+)$/i);
  if (catPickMatch) {
    const txNo = parseInt(catPickMatch[1], 10);
    const catNo = parseInt(catPickMatch[2], 10);
    if (!Number.isFinite(txNo) || txNo < 1 || txNo > state.transactions.length) {
      await message.reply('Nomor transaksi tidak valid.');
      return true;
    }
    const cats = await listCategories(state.accountId);
    if (!Number.isFinite(catNo) || catNo < 1 || catNo > cats.length) {
      await message.reply('Nomor kategori tidak valid.');
      return true;
    }
    state.transactions[txNo - 1].kategori = cats[catNo - 1];
    await sendPendingTransactionPreview(message, senderId, state);
    return true;
  }

  if (messageBody === 'lihat') {
    await sendPendingTransactionPreview(message, senderId, state);
    return true;
  }

  if (messageBody === 'batal' || messageBody === 'batalkan' || messageBody === 'cancel') {
    clearUserState(senderId);
    await message.reply('✅ Dibatalin. Tidak ada transaksi yang disimpan.');
    return true;
  }

  if (messageBody === 'ok' || messageBody === 'ok paksa' || messageBody === 'ya' || messageBody === 'simpan') {
    const force = messageBody.includes('paksa');
    const allErrors = [];
    state.transactions.forEach((tx, idx) => {
      const v = validateTransaction(tx);
      if (v.errors.length > 0) {
        allErrors.push(`Transaksi ${idx + 1}: ${v.errors.join(', ')}`);
      }
    });
    if (allErrors.length > 0 && !force) {
      await message.reply(`❌ Masih ada yang harus diperbaiki:\n- ${allErrors.join('\n- ')}\n\nBalas "ok paksa" untuk tetap menyimpan.`);
      return true;
    }
    try {
      for (const tx of state.transactions) {
        await insertTransaction(state.accountId, tx, senderId);
      }
      clearUserState(senderId);
      await message.reply(`✅ Disimpan ${state.transactions.length} transaksi.`);

      try {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
        const userCurrency = await getUserCurrency(senderId);

        const budgets = await listMonthlyBudgets(state.accountId, monthKey);
        if (budgets.length > 0) {
          const spend = await getSpendingByCategory(state.accountId, startDate, endDate, userCurrency);
          for (const b of budgets) {
            const spent = spend[b.category] || 0;
            const limit = convertAmount(parseFloat(b.limit_amount), b.currency, userCurrency);
            if (!Number.isFinite(limit) || limit <= 0) continue;
            const pct = (spent / limit) * 100;
            if (pct >= 100) {
              const first = await tryMarkBudgetNotification(state.accountId, monthKey, b.category, 100);
              if (first) {
                await message.reply(`⚠️ Budget lewat: ${b.category} ${Math.round(pct)}% (Rp${formatMoney(spent)} / Rp${formatMoney(limit)})`);
              }
            } else if (pct >= 80) {
              const first = await tryMarkBudgetNotification(state.accountId, monthKey, b.category, 80);
              if (first) {
                await message.reply(`⚠️ Budget hampir habis: ${b.category} ${Math.round(pct)}% (Rp${formatMoney(spent)} / Rp${formatMoney(limit)})`);
              }
            }
          }
        }
      } catch {}
    } catch {
      await message.reply('❌ Gagal menyimpan transaksi.');
    }
    return true;
  }

  const baseMatch = rawMessageBody.match(/^ubah transaksi\s+(\d+)\s+(.+)$/i);
  if (!baseMatch) {
    await message.reply('Perintah tidak dikenali. Balas "lihat" untuk lihat preview.');
    return true;
  }

  const index = parseInt(baseMatch[1], 10);
  const tail = baseMatch[2].trim();
  if (!Number.isFinite(index) || index < 1 || index > state.transactions.length) {
    await message.reply('Nomor transaksi tidak valid.');
    return true;
  }

  const tx = state.transactions[index - 1];

  const fieldMatch = tail.match(/^(jumlah|kategori|keterangan|tanggal)\s+(.+)$/i);
  if (fieldMatch) {
    const field = fieldMatch[1].toLowerCase();
    const value = fieldMatch[2].trim();
    if (field === 'jumlah') {
      const amount = parseInt(value.replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(amount)) {
        await message.reply('Jumlah tidak valid.');
        return true;
      }
      tx.nominal = amount;
    } else if (field === 'kategori') {
      const v = value.trim();
      if (v.toLowerCase() === 'pilih' || v.toLowerCase() === 'list') {
        const cats = await listCategories(state.accountId);
        if (cats.length === 0) {
          await message.reply('Belum ada kategori. Tambah dulu: kategori tambah <nama>');
          return true;
        }
        const list = createList(
          `Pilih kategori untuk transaksi ${index}:`,
          'Pilih',
          [
            {
              title: 'Kategori',
              rows: cats.slice(0, 50).map((c, i) => ({
                id: `txcat_${index}_${i + 1}`,
                title: c,
              })),
            },
          ],
          'Kategori',
          '',
        );
        if (list) {
          await message.reply(list);
          return true;
        }
        const lines = cats.map((c, i) => `${i + 1}. ${c}`).join('\n');
        await message.reply(`🏷️ Pilih kategori:\n${lines}\n\nKetik: ubah transaksi ${index} kategori <nomor>`);
        return true;
      }
      const numMatch = v.match(/^#?(\d+)$/);
      if (numMatch) {
        const cats = await listCategories(state.accountId);
        const no = parseInt(numMatch[1], 10);
        if (!Number.isFinite(no) || no < 1 || no > cats.length) {
          await message.reply('Nomor kategori tidak valid.');
          return true;
        }
        tx.kategori = cats[no - 1];
      } else {
        tx.kategori = value;
      }
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

  const addItemMatch = tail.match(/^item\s+tambah\s+(.+)\s+(\d+)\s+(\d[\d.,]*)$/i);
  if (addItemMatch) {
    const name = addItemMatch[1].trim();
    const qty = parseInt(addItemMatch[2], 10);
    const price = parseInt(addItemMatch[3].replace(/[^0-9]/g, ''), 10);
    if (!name || !Number.isFinite(qty) || !Number.isFinite(price)) {
      await message.reply('Format item tambah tidak valid.');
      return true;
    }
    if (!tx.items) tx.items = [];
    tx.items.push({ item_name: name, quantity: qty, price });
    await sendPendingTransactionPreview(message, senderId, state);
    return true;
  }

  const delItemMatch = tail.match(/^item\s+hapus\s+(\d+)$/i);
  if (delItemMatch) {
    const itemNo = parseInt(delItemMatch[1], 10);
    if (!tx.items || tx.items.length === 0) {
      await message.reply('Tidak ada item untuk dihapus.');
      return true;
    }
    if (!Number.isFinite(itemNo) || itemNo < 1 || itemNo > tx.items.length) {
      await message.reply('Nomor item tidak valid.');
      return true;
    }
    tx.items.splice(itemNo - 1, 1);
    await sendPendingTransactionPreview(message, senderId, state);
    return true;
  }

  const editItemMatch = tail.match(/^item\s+ubah\s+(\d+)\s+(\d+)\s+(\d[\d.,]*)$/i);
  if (editItemMatch) {
    const itemNo = parseInt(editItemMatch[1], 10);
    const qty = parseInt(editItemMatch[2], 10);
    const price = parseInt(editItemMatch[3].replace(/[^0-9]/g, ''), 10);
    if (!tx.items || tx.items.length === 0) {
      await message.reply('Tidak ada item untuk diubah.');
      return true;
    }
    if (!Number.isFinite(itemNo) || itemNo < 1 || itemNo > tx.items.length) {
      await message.reply('Nomor item tidak valid.');
      return true;
    }
    if (!Number.isFinite(qty) || !Number.isFinite(price)) {
      await message.reply('Qty/harga tidak valid.');
      return true;
    }
    tx.items[itemNo - 1].quantity = qty;
    tx.items[itemNo - 1].price = price;
    await sendPendingTransactionPreview(message, senderId, state);
    return true;
  }

  await message.reply('Format ubah transaksi tidak dikenali. Balas "lihat" untuk lihat preview.');
  return true;
}

module.exports = { handlePendingTransactionMessage, sendPendingTransactionPreview };
