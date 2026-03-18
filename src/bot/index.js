const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { ensureSchema, getActiveAccountContext, runDueRecurring } = require('../db');
const { isGroupChatId } = require('./utils');
const { getUserState, clearUserState } = require('./state');
const report = require('./report');
const account = require('./account');
const tx = require('./transaction');

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
  });

  client.on('message', async (message) => {
    const senderId = message.from;
    await dbReady;

    const rawMessageBody = message.body
      .replace(/@\d+/g, '')
      .replace(/\s\s+/g, ' ')
      .trim();
    const messageBody = rawMessageBody.toLowerCase();

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
      try {
        await runDueRecurring(ctx.accountId);
      } catch (e) {
        console.error('Recurring run failed:', e);
      }
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

    if (messageBody === 'token' || messageBody === 'token saya') {
      await account.handleTokenShow(message, senderId);
      return;
    }

    if (messageBody === 'token reset' || messageBody === 'reset token') {
      await account.handleTokenReset(message, senderId);
      return;
    }

    if (messageBody.startsWith('pakai token ') || messageBody.startsWith('gunakan token ')) {
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
      const ctx = await getCtx(true);
      if (!ctx) return;
      await account.handleInvite(message, senderId, ctx.accountId, rawMessageBody);
      return;
    }

    if (messageBody.startsWith('akses')) {
      const ctx = await getCtx(true);
      if (!ctx) return;
      await account.handleAccess(message, senderId, ctx.accountId, rawMessageBody);
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
