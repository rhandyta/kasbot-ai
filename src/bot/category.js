const { addCategory, listCategories, upsertMerchantRule, listMerchantRules } = require('../db');

async function handleCategoryCommand(message, senderId, accountId, rawMessageBody) {
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();

  if (!sub || sub === 'list') {
    const cats = await listCategories(accountId);
    if (cats.length === 0) {
      await message.reply('Belum ada kategori. Contoh: "kategori tambah Makan"');
      return;
    }
    await message.reply(`🏷️ *Kategori*\n\n${cats.map((c) => `- ${c}`).join('\n')}`);
    return;
  }

  if (sub === 'tambah') {
    const name = rawMessageBody.replace(/^kategori\s+tambah\s+/i, '').trim();
    if (!name) {
      await message.reply('Format: "kategori tambah <nama>"');
      return;
    }
    try {
      await addCategory(accountId, senderId, name);
      await message.reply(`✅ Kategori ditambahkan: ${name}`);
    } catch (e) {
      await message.reply(e.message || 'Gagal menambah kategori.');
    }
    return;
  }

  if (sub === 'map') {
    const rest = rawMessageBody.replace(/^kategori\s+map\s+/i, '').trim();
    const m = rest.match(/^(.+?)\s+=>\s+(.+)$/);
    if (!m) {
      await message.reply('Format: "kategori map <keyword> => <kategori>"');
      return;
    }
    const keyword = m[1].trim();
    const category = m[2].trim();
    try {
      await upsertMerchantRule(accountId, senderId, keyword, category);
      await message.reply(`✅ Mapping disimpan: "${keyword}" => ${category}`);
    } catch (e) {
      await message.reply(e.message || 'Gagal menyimpan mapping.');
    }
    return;
  }

  if (sub === 'rules') {
    const rules = await listMerchantRules(accountId);
    if (rules.length === 0) {
      await message.reply('Belum ada mapping. Contoh: "kategori map indomaret => Belanja"');
      return;
    }
    const lines = rules.map((r) => `- "${r.keyword}" => ${r.category}`).join('\n');
    await message.reply(`🧩 *Mapping Merchant*\n\n${lines}`);
    return;
  }

  await message.reply('Perintah kategori: "kategori list", "kategori tambah ...", "kategori map ... => ...", "kategori rules"');
}

module.exports = { handleCategoryCommand };
