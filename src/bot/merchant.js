const { upsertMerchantRule, listMerchantRules } = require('../db');

async function handleMerchantCommand(message, senderId, accountId, rawMessageBody) {
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();

  if (!sub || sub === 'rules' || sub === 'list') {
    const rules = await listMerchantRules(accountId);
    if (rules.length === 0) {
      await message.reply('Belum ada mapping merchant. Contoh: "merchant map indomaret => Indomaret"');
      return;
    }
    const lines = rules.map((r) => `- "${r.keyword}" => ${r.merchant}`).join('\n');
    await message.reply(`🏪 *Mapping Merchant*\n\n${lines}`);
    return;
  }

  if (sub === 'map') {
    const rest = rawMessageBody.replace(/^merchant\s+map\s+/i, '').trim();
    const m = rest.match(/^(.+?)\s+=>\s+(.+)$/);
    if (!m) {
      await message.reply('Format: "merchant map <keyword> => <nama merchant>"');
      return;
    }
    const keyword = m[1].trim();
    const merchant = m[2].trim();
    try {
      await upsertMerchantRule(accountId, senderId, keyword, merchant);
      await message.reply(`✅ Mapping merchant disimpan: "${keyword}" => ${merchant}`);
    } catch (e) {
      await message.reply(e.message || 'Gagal menyimpan mapping merchant.');
    }
    return;
  }

  await message.reply('Perintah merchant: "merchant rules" atau "merchant map <keyword> => <merchant>"');
}

module.exports = { handleMerchantCommand };
