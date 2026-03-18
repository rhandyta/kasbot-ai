const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const {
  ensureSchema,
  getActiveAccountContext,
  listAllOwnerAccounts,
  listAccountOwners,
  getSummaryTotals,
  tryMarkSummaryNotification,
} = require('../db');
const { isGroupChatId, formatDateYyyyMmDd } = require('./utils');
const { getUserState, clearUserState } = require('./state');
const report = require('./report');
const account = require('./account');
const tx = require('./transaction');
const category = require('./category');
const { extractInteractiveId } = require('./interactive');

const attemptBuckets = new Map();

function allowAttempt(bucketKey, limit, windowMs) {
  const now = Date.now();
  const existing = attemptBuckets.get(bucketKey);
  if (!existing || now > existing.resetAt) {
    attemptBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

function createBot() {
  const dbReady = ensureSchema();

  const client = new Client({
    authStrategy: new LocalAuth(),
  });

  client.on('qr', (qr) => {
    console.log('QR RECEIVED, scan it with your phone');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('Client is ready!');
    const runSummaries = async () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();

      if (hour === 21 && minute <= 4) {
        const dayKey = formatDateYyyyMmDd(now);
        const accounts = await listAllOwnerAccounts();
        for (const accountId of accounts) {
          const first = await tryMarkSummaryNotification(accountId, 'daily', dayKey);
          if (!first) continue;
          const totals = await getSummaryTotals(accountId, dayKey, dayKey);
          const owners = await listAccountOwners(accountId);
          const lines = totals.map((r) => `- ${r.type} ${r.currency}: ${Math.round(Number(r.total) || 0)}`).join('\n');
          const msg = `🧾 Ringkasan harian (${dayKey})\n${lines || '- (tidak ada transaksi)'}`;
          for (const owner of owners) {
            try {
              await client.sendMessage(owner, msg);
            } catch {}
          }
        }
      }

      if (now.getDay() === 1 && hour === 9 && minute <= 4) {
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
        const startKey = formatDateYyyyMmDd(start);
        const endKey = formatDateYyyyMmDd(end);
        const weekKey = startKey;
        const accounts = await listAllOwnerAccounts();
        for (const accountId of accounts) {
          const first = await tryMarkSummaryNotification(accountId, 'weekly', weekKey);
          if (!first) continue;
          const totals = await getSummaryTotals(accountId, startKey, endKey);
          const owners = await listAccountOwners(accountId);
          const lines = totals.map((r) => `- ${r.type} ${r.currency}: ${Math.round(Number(r.total) || 0)}`).join('\n');
          const msg = `🧾 Ringkasan mingguan (${startKey} s/d ${endKey})\n${lines || '- (tidak ada transaksi)'}`;
          for (const owner of owners) {
            try {
              await client.sendMessage(owner, msg);
            } catch {}
          }
        }
      }
    };

    runSummaries().catch(() => {});
    setInterval(() => {
      runSummaries().catch(() => {});
    }, 60 * 1000);
  });

  client.on('message', async (message) => {
    const senderId = message.from;
    await dbReady;

    let rawMessageBody = message.body
      .replace(/@\d+/g, '')
      .replace(/\s\s+/g, ' ')
      .trim();
    const interactiveId = extractInteractiveId(message);
    if (interactiveId) {
      rawMessageBody = interactiveId;
    }
    let messageBody = rawMessageBody.toLowerCase();

    const currentState = getUserState(senderId);
    if (currentState?.step === 'awaiting_tx_confirmation') {
      await tx.handlePendingTransactionMessage(message, senderId, messageBody, rawMessageBody);
      return;
    }

    const isGroup = isGroupChatId(senderId);
    const sensitiveInGroup = [
      'token',
      'token saya',
      'token reset',
      'reset token',
      'invite',
      'akses',
      'export',
      'struk terakhir',
      'lihat struk terakhir',
      'kategori',
    ];
    if (isGroup) {
      const matched = sensitiveInGroup.some((p) => messageBody === p || messageBody.startsWith(`${p} `));
      if (matched) {
        await message.reply('Perintah ini hanya bisa dipakai lewat chat pribadi.');
        return;
      }
    }

    const getCtx = async (requireWrite = false) => {
      const ctx = await getActiveAccountContext(senderId);
      if (requireWrite && !ctx.canWrite) {
        await message.reply(
          'Akun aktif kamu sedang mode monitoring (read-only). Kirim "monitor off" untuk kembali ke akun kamu.',
        );
        return null;
      }
      return ctx;
    };

    if (messageBody === 'help' || messageBody === 'menu' || messageBody === '/help') {
      const ctx = await getCtx(false);
      if (!ctx) return;
      await account.handleHelp(message, ctx.canWrite);
      return;
    }

    if (messageBody === 'kategori' || messageBody.startsWith('kategori ')) {
      const ctx = await getCtx(true);
      if (!ctx) return;
      await category.handleCategoryCommand(message, senderId, ctx.accountId, rawMessageBody);
      return;
    }

    if (messageBody === 'token' || messageBody === 'token saya') {
      await account.handleTokenShow(message, senderId);
      return;
    }

    if (messageBody === 'token reset' || messageBody === 'reset token') {
      const ok = allowAttempt(`${senderId}:token_reset`, 3, 60 * 60 * 1000);
      if (!ok) {
        await message.reply('Terlalu banyak percobaan. Coba lagi nanti.');
        return;
      }
      await account.handleTokenReset(message, senderId);
      return;
    }

    if (messageBody.startsWith('pakai token ') || messageBody.startsWith('gunakan token ')) {
      const ok = allowAttempt(`${senderId}:join_token`, 5, 10 * 60 * 1000);
      if (!ok) {
        await message.reply('Terlalu banyak percobaan token. Coba lagi nanti.');
        return;
      }
      const token = rawMessageBody.split(' ').slice(2).join(' ').trim();
      await account.handleJoinToken(message, senderId, token);
      return;
    }

    if (
      messageBody === 'monitor off' ||
      messageBody === 'monitor berhenti' ||
      messageBody === 'stop monitor'
    ) {
      await account.handleMonitorOff(message, senderId);
      return;
    }

    if (messageBody === 'akun' || messageBody === 'akun saya') {
      await account.handleAccountList(message, senderId);
      return;
    }

    if (messageBody === 'akun baru') {
      await account.handleAccountNew(message, senderId);
      return;
    }

    if (messageBody.startsWith('akun pilih ')) {
      const idxRaw = rawMessageBody.split(' ').slice(2).join(' ').trim();
      const idx = parseInt(idxRaw, 10);
      await account.handleAccountPick(message, senderId, idx);
      return;
    }

    if (messageBody === 'struk terakhir' || messageBody === 'lihat struk terakhir') {
      const ctx = await getCtx(false);
      if (!ctx) return;
      await tx.handleLastReceipt(client, message, senderId, ctx.accountId);
      return;
    }

    if (messageBody.startsWith('export')) {
      const ctx = await getCtx(false);
      if (!ctx) return;
      await tx.handleExport(client, message, senderId, ctx.accountId, rawMessageBody);
      return;
    }

    if (messageBody.startsWith('budget')) {
      const ctx = await getCtx(false);
      if (!ctx) return;
      await tx.handleBudget(message, senderId, ctx.accountId, rawMessageBody, ctx.canWrite);
      return;
    }

    if (messageBody.startsWith('ulang')) {
      const ctx = await getCtx(false);
      if (!ctx) return;
      await tx.handleRecurring(message, senderId, ctx.accountId, rawMessageBody, ctx.canWrite);
      return;
    }

    if (messageBody.startsWith('invite')) {
      const ok = allowAttempt(`${senderId}:invite`, 10, 60 * 1000);
      if (!ok) {
        await message.reply('Terlalu banyak request. Coba lagi nanti.');
        return;
      }
      const ctx = await getCtx(true);
      if (!ctx) return;
      await account.handleInvite(message, senderId, ctx.accountId, rawMessageBody);
      return;
    }

    if (messageBody.startsWith('akses')) {
      const ok = allowAttempt(`${senderId}:akses`, 10, 60 * 1000);
      if (!ok) {
        await message.reply('Terlalu banyak request. Coba lagi nanti.');
        return;
      }
      const ctx = await getCtx(true);
      if (!ctx) return;
      await account.handleAccess(message, senderId, ctx.accountId, rawMessageBody);
      return;
    }

    if (
      messageBody === 'undo kembali' ||
      messageBody === 'undo restore' ||
      messageBody === 'kembalikan undo'
    ) {
      const ctx = await getCtx(true);
      if (!ctx) return;
      await tx.handleRestoreLastTransaction(message, senderId, ctx.accountId);
      return;
    }

    if (
      messageBody === 'undo' ||
      messageBody === 'batal' ||
      messageBody === 'batalkan' ||
      messageBody.includes('batal transaksi')
    ) {
      const ctx = await getCtx(true);
      if (!ctx) return;
      await tx.handleCancelTransaction(message, senderId, ctx.accountId);
      return;
    }

    if (messageBody.startsWith('cari') || messageBody.startsWith('search')) {
      const ctx = await getCtx(false);
      if (!ctx) return;
      const keyword = messageBody.split(' ').slice(1).join(' ');
      await tx.handleSearch(message, ctx.accountId, keyword);
      return;
    }

    if (messageBody.startsWith('edit transaksi') || messageBody.startsWith('ubah transaksi')) {
      const ctx = await getCtx(true);
      if (!ctx) return;
      await tx.handleEditTransaction(message, senderId, ctx.accountId, messageBody);
      return;
    }

    const currencyMatch = messageBody.match(/^set currency (\w{3})$/i);
    if (currencyMatch) {
      const ctx = await getCtx(true);
      if (!ctx) return;
      const currency = currencyMatch[1].toUpperCase();
      await tx.handleSetCurrency(message, senderId, currency);
      return;
    }

    if (messageBody === 'laporan' || messageBody === '/laporan') {
      clearUserState(senderId);
      await report.startReportFlow(client, senderId);
      return;
    }

    const ctx = await getCtx(false);
    if (!ctx) return;

    const handled = await report.handleStatefulMessage(message, senderId, messageBody, ctx.accountId);
    if (handled) return;

    const writeCtx = await getCtx(true);
    if (!writeCtx) return;
    await tx.processTransaction(message, senderId, writeCtx.accountId);
  });

  return client;
}

function startBot() {
  console.log('Starting WhatsApp client...');
  const client = createBot();
  client.initialize();
  console.log('Initializing client...');
  return client;
}

module.exports = { startBot };
