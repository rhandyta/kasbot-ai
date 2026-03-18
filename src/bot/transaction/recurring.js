const { getUserCurrency, addRecurringRule, listRecurringRules, removeRecurringRule, convertAmount } = require('../../db');
const { formatMoney } = require('../utils');

async function handleRecurring(message, senderId, accountId, rawMessageBody, canWrite) {
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();
  const userCurrency = await getUserCurrency(senderId);

  if (sub === 'list') {
    const rules = await listRecurringRules(accountId);
    if (rules.length === 0) {
      await message.reply('Belum ada transaksi berulang. Contoh: "ulang tambah out 50000 Makan ; makan siang ; 10"');
      return;
    }
    let txt = '🔁 *Transaksi Berulang*\n\n';
    rules.forEach((r) => {
      const status = r.active ? 'aktif' : 'nonaktif';
      const amount = convertAmount(parseFloat(r.amount), r.currency, userCurrency);
      txt += `- ID ${r.id}: ${r.type} Rp${formatMoney(amount)} ${r.category} (tgl ${r.day_of_month}) next ${r.next_run_date} (${status})\n`;
    });
    await message.reply(txt);
    return;
  }

  if (sub === 'hapus') {
    if (!canWrite) {
      await message.reply('Mode monitoring tidak bisa ubah recurring. Kirim "monitor off" dulu.');
      return;
    }
    const id = parseInt(parts[2], 10);
    if (!Number.isFinite(id)) {
      await message.reply('Format: "ulang hapus <id>"');
      return;
    }
    await removeRecurringRule(accountId, senderId, id);
    await message.reply(`✅ Recurring ID ${id} dinonaktifkan.`);
    return;
  }

  if (sub === 'tambah') {
    if (!canWrite) {
      await message.reply('Mode monitoring tidak bisa tambah recurring. Kirim "monitor off" dulu.');
      return;
    }
    const payload = rawMessageBody.replace(/^ulang\s+tambah\s+/i, '').trim();
    const seg = payload.split(';').map((s) => s.trim()).filter(Boolean);
    const first = (seg[0] || '').split(/\s+/);
    const type = (first[0] || '').toUpperCase();
    const amount = parseInt((first[1] || '').replace(/[^0-9]/g, ''), 10);
    const category = first.slice(2).join(' ').trim();
    const description = seg[1] || null;
    const day = seg[2] ? parseInt(seg[2].replace(/[^0-9]/g, ''), 10) : null;
    if (!['IN', 'OUT'].includes(type) || !Number.isFinite(amount) || !category || !Number.isFinite(day)) {
      await message.reply('Format: "ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>"');
      return;
    }
    const created = await addRecurringRule(accountId, senderId, {
      type,
      amount,
      currency: userCurrency,
      category,
      description,
      day_of_month: day,
    });
    await message.reply(`✅ Recurring ditambahkan. Next run: ${created.next_run_date} (ID ${created.id})`);
    return;
  }

  await message.reply('Perintah ulang: "ulang list", "ulang tambah ...", "ulang hapus <id>"');
}

module.exports = { handleRecurring };
