const { getUserCurrency, setMonthlyBudget, listMonthlyBudgets, getSpendingByCategory, convertAmount } = require('../../db');
const { formatMoney } = require('../utils');

async function handleBudget(message, senderId, accountId, rawMessageBody, canWrite) {
  const parts = rawMessageBody.trim().split(/\s+/);
  const cmd = (parts[1] || '').toLowerCase();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const userCurrency = await getUserCurrency(senderId);

  if (cmd === 'set') {
    if (!canWrite) {
      await message.reply('Mode monitoring tidak bisa set budget. Kirim "monitor off" dulu.');
      return;
    }
    const tail = rawMessageBody.replace(/^budget\s+set\s+/i, '').trim();
    const m = tail.match(/^(.*)\s+(\d[\d.,]*)$/);
    if (!m) {
      await message.reply('Format: "budget set <kategori> <jumlah>"');
      return;
    }
    const category = m[1].trim();
    const amount = parseInt(m[2].replace(/[^0-9]/g, ''), 10);
    if (!category || !Number.isFinite(amount)) {
      await message.reply('Kategori/jumlah tidak valid.');
      return;
    }
    await setMonthlyBudget(accountId, senderId, monthKey, category, amount, userCurrency);
    await message.reply(`✅ Budget diset: ${category} = Rp${formatMoney(amount)} (${monthKey})`);
    return;
  }

  if (cmd === 'list' || cmd === 'status' || cmd === '') {
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const budgets = await listMonthlyBudgets(accountId, monthKey);
    const spend = await getSpendingByCategory(accountId, startDate, endDate, userCurrency);
    if (budgets.length === 0) {
      await message.reply('Belum ada budget bulan ini. Contoh: "budget set Makan 1500000"');
      return;
    }
    let txt = `📌 *Budget (${monthKey})*\n\n`;
    budgets.forEach((b) => {
      const spent = spend[b.category] || 0;
      const limit = convertAmount(parseFloat(b.limit_amount), b.currency, userCurrency);
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      txt += `- ${b.category}: Rp${formatMoney(spent)} / Rp${formatMoney(limit)} (${pct}%)\n`;
    });
    await message.reply(txt);
    return;
  }

  await message.reply('Perintah budget: "budget set <kategori> <jumlah>" atau "budget list"');
}

module.exports = { handleBudget };
