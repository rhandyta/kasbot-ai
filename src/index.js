const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { recognizeText } = require("./ocr");
const { structureText } = require("./ai");
const {
  ensureSchema,
  getActiveAccountContext,
  getActiveAccountToken,
  rotateActiveAccountToken,
  joinAccountByToken,
  createAccountAndSetActive,
  listUserAccounts,
  setActiveAccount,
  switchToOwnedAccount,
  createInvite,
  listInvites,
  revokeInvite,
  listMembers,
  revokeMember,
  setMonthlyBudget,
  listMonthlyBudgets,
  getSpendingByCategory,
  addRecurringRule,
  listRecurringRules,
  removeRecurringRule,
  runDueRecurring,
  getTransactionsForExport,
  getLastReceiptTransaction,
  findTransactionByReceiptHash,
  insertTransaction,
  getTransactions,
  getLastTransactions,
  deleteLastTransaction,
  searchTransactions,
  updateTransaction,
  getUserCurrency,
  setUserCurrency,
} = require("./db");
const { saveReceipt } = require("./file-saver");

console.log("Starting WhatsApp client...");

const dbReady = ensureSchema();

const client = new Client({
  authStrategy: new LocalAuth(),
});

// In-memory state management for conversations
const userState = {};

client.on("qr", (qr) => {
  console.log("QR RECEIVED, scan it with your phone");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("Client is ready!");
});

// --- Main Message Handler ---
client.on("message", async (message) => {
  const senderId = message.from;
  await dbReady;
  const rawMessageBody = message.body.replace(/@\d+/g, "").replace(/\s\s+/g, " ").trim();
  const messageBody = rawMessageBody.toLowerCase();
  const currentState = userState[senderId];

  if (currentState && currentState.step === "awaiting_tx_confirmation") {
    await handlePendingTransactionMessage(message, senderId, messageBody, rawMessageBody, currentState);
    return;
  }

  if (messageBody === "help" || messageBody === "menu" || messageBody === "/help") {
    await handleHelp(message, senderId);
    return;
  }

  if (messageBody === "token" || messageBody === "token saya") {
    await handleTokenShow(message, senderId);
    return;
  }

  if (messageBody === "token reset" || messageBody === "reset token") {
    await handleTokenReset(message, senderId);
    return;
  }

  if (messageBody.startsWith("pakai token ") || messageBody.startsWith("gunakan token ")) {
    const token = rawMessageBody.split(" ").slice(2).join(" ").trim();
    await handleJoinToken(message, senderId, token);
    return;
  }

  if (messageBody === "monitor off" || messageBody === "monitor berhenti" || messageBody === "stop monitor") {
    await handleMonitorOff(message, senderId);
    return;
  }

  if (messageBody === "akun" || messageBody === "akun saya") {
    await handleAccountList(message, senderId);
    return;
  }

  if (messageBody === "akun baru") {
    await handleAccountNew(message, senderId);
    return;
  }

  if (messageBody.startsWith("akun pilih ")) {
    const idxRaw = rawMessageBody.split(" ").slice(2).join(" ").trim();
    const idx = parseInt(idxRaw, 10);
    await handleAccountPick(message, senderId, idx);
    return;
  }

  // Cancel last transaction
  if (messageBody === "undo" || messageBody === "batal" || messageBody === "batalkan" || messageBody.includes("batal transaksi")) {
    await handleCancelTransaction(message, senderId);
    return;
  }

  if (messageBody === "struk terakhir" || messageBody === "lihat struk terakhir") {
    await handleLastReceipt(message, senderId);
    return;
  }

  if (messageBody.startsWith("export")) {
    await handleExport(message, senderId, rawMessageBody);
    return;
  }

  if (messageBody.startsWith("budget")) {
    await handleBudget(message, senderId, rawMessageBody);
    return;
  }

  if (messageBody.startsWith("ulang")) {
    await handleRecurring(message, senderId, rawMessageBody);
    return;
  }

  if (messageBody.startsWith("invite")) {
    await handleInvite(message, senderId, rawMessageBody);
    return;
  }

  if (messageBody.startsWith("akses")) {
    await handleAccess(message, senderId, rawMessageBody);
    return;
  }

  // Search transactions
  if (messageBody.startsWith('cari') || messageBody.startsWith('search')) {
    const keyword = messageBody.split(' ').slice(1).join(' ');
    await handleSearch(message, senderId, keyword);
    return;
  }

  // Edit transaction
  if (messageBody.startsWith('edit transaksi') || messageBody.startsWith('ubah transaksi')) {
    await handleEditTransaction(message, senderId, messageBody);
    return;
  }

  // Set currency preference
  const currencyMatch = messageBody.match(/^set currency (\w{3})$/i);
  if (currencyMatch) {
    const currency = currencyMatch[1].toUpperCase();
    await handleSetCurrency(message, senderId, currency);
    return;
  }

  // Always allow restarting or resetting the conversation flow
  if (messageBody === "laporan" || messageBody === "/laporan") {
    // If the user was in the middle of something, clear their state.
    if (userState[senderId]) {
      delete userState[senderId];
    }
    await startReportFlow(senderId);
    return; // Stop further processing
  }

  // If the user is in a stateful conversation, handle it
  if (currentState) {
    await handleStatefulMessage(message, senderId, messageBody, currentState);
    return;
  }

  // Otherwise, process the message as a potential new transaction
  await processTransaction(message, senderId);
});

// --- Flow Controllers ---

async function handleStatefulMessage(
  message,
  senderId,
  messageBody,
  currentState,
) {
  if (currentState.step === "awaiting_report_period") {
    await handleReportPeriodSelection(message, senderId, messageBody);
  } else if (
    currentState.step === "awaiting_detail_request" &&
    messageBody === "detail"
  ) {
    await handleDetailRequest(message, senderId);
  } else {
    // If the message doesn't match an expected state, reset the state and inform the user.
    delete userState[senderId];
    await message.reply(
      'Perintah tidak dikenali. Kembali ke mode normal. Kirim "laporan" untuk memulai lagi.',
    );
  }
}

async function startReportFlow(senderId) {
  userState[senderId] = { step: "awaiting_report_period" };
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

async function getAccountContextOrReply(message, senderId, requireWrite = false) {
  const ctx = await getActiveAccountContext(senderId);
  try {
    await runDueRecurring(ctx.accountId);
  } catch (e) {
    console.error("Recurring run failed:", e);
  }
  if (requireWrite && !ctx.canWrite) {
    await message.reply(
      'Akun aktif kamu sedang mode monitoring (read-only). Kirim "monitor off" untuk kembali ke akun kamu.',
    );
    return null;
  }
  return ctx;
}

async function handleCancelTransaction(message, senderId) {
  const ctx = await getAccountContextOrReply(message, senderId, true);
  if (!ctx) return;
  try {
    const deletedId = await deleteLastTransaction(ctx.accountId, senderId);
    await message.reply(`✅ Transaksi terakhir (ID: ${deletedId}) berhasil dibatalkan.`);
  } catch (error) {
    console.error("Failed to cancel transaction:", error);
    await message.reply("❌ Gagal membatalkan transaksi. Mungkin tidak ada transaksi yang bisa dibatalkan.");
  }
}

async function handleSearch(message, senderId, keyword) {
  if (!keyword.trim()) {
    return message.reply('Masukkan kata kunci pencarian. Contoh: "cari beli ayam"');
  }
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  try {
    const transactions = await searchTransactions(ctx.accountId, keyword);
    if (transactions.length === 0) {
      return message.reply(`Tidak ditemukan transaksi dengan kata kunci "${keyword}".`);
    }
    let reply = `🔍 *Hasil pencarian untuk "${keyword}":*\n\n`;
    transactions.forEach((tx, idx) => {
      const sign = tx.type === 'IN' ? '+' : '-';
      const date = new Date(tx.transaction_date).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
      });
      const amount = new Intl.NumberFormat('id-ID').format(tx.amount);
      reply += `*${idx + 1}. ${date}: ${sign}Rp${amount}* (${tx.category} - ${tx.description || 'N/A'})\n`;
      if (tx.items && tx.items.length > 0) {
        tx.items.forEach(item => {
          const itemPrice = new Intl.NumberFormat('id-ID').format(item.price);
          reply += `  - ${item.item_name} (${item.quantity}x) @ Rp${itemPrice}\n`;
        });
      }
      reply += '\n';
    });
    await message.reply(reply);
  } catch (error) {
    console.error('Search error:', error);
    await message.reply('Terjadi kesalahan saat mencari transaksi.');
  }
}

async function handleEditTransaction(message, senderId, messageBody) {
  const ctx = await getAccountContextOrReply(message, senderId, true);
  if (!ctx) return;
  // Simple parsing: assume format "edit transaksi terakhir jumlah 75000"
  const parts = messageBody.split(' ');
  const amountIndex = parts.findIndex(p => p === 'jumlah' || p === 'nominal');
  if (amountIndex === -1) {
    return message.reply('Format edit tidak valid. Contoh: "edit transaksi terakhir jumlah 75000"');
  }
  const amount = parseInt(parts[amountIndex + 1].replace(/[^0-9]/g, ''));
  if (isNaN(amount)) {
    return message.reply('Jumlah tidak valid.');
  }
  try {
    // Get last transaction ID
    const lastTransactions = await getLastTransactions(ctx.accountId, 1);
    if (lastTransactions.length === 0) {
      return message.reply('Tidak ada transaksi untuk diedit.');
    }
    const lastId = lastTransactions[0].id;
    await updateTransaction(ctx.accountId, lastId, { amount }, senderId);
    await message.reply(`✅ Transaksi terakhir (ID: ${lastId}) berhasil diubah jumlah menjadi Rp${new Intl.NumberFormat('id-ID').format(amount)}.`);
  } catch (error) {
    console.error('Edit error:', error);
    await message.reply('Gagal mengedit transaksi.');
  }
}

async function handleSetCurrency(message, senderId, currency) {
  // Validate currency code (simple)
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

async function handleReportPeriodSelection(message, senderId, choice) {
  const userCurrency = await getUserCurrency(senderId);
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const normalizedChoice = choice.replace(/\./g, "").trim();

  // Handle "last 10" separately as it doesn't use a date range
  if (
    normalizedChoice.match(/^(1|10)$/) ||
    choice.match(/10 (transaksi )?terakhir/)
  ) {
    try {
      const transactions = await getLastTransactions(ctx.accountId, 10, userCurrency);
      if (transactions.length === 0) {
        delete userState[senderId];
        return message.reply("Tidak ada transaksi yang ditemukan.");
      }
      // The rest of the logic is the same, so we can reuse it
      return presentReport(
        message,
        senderId,
        transactions,
        "10 Transaksi Terakhir",
      );
    } catch (error) {
      console.error(error);
      delete userState[senderId];
      return message.reply("Maaf, terjadi kesalahan saat mengambil laporan.");
    }
  }

  const { startDate, endDate, periodName } = getDateRange(normalizedChoice);

  if (!startDate) {
    delete userState[senderId];
    return message.reply(
      'Pilihan tidak valid. Silakan mulai lagi dengan mengirim "laporan".',
    );
  }

  try {
    const transactions = await getTransactions(ctx.accountId, startDate, endDate, userCurrency);
    if (transactions.length === 0) {
      delete userState[senderId];
      return message.reply(
        `Tidak ada transaksi yang ditemukan untuk periode "${periodName}".`,
      );
    }
    presentReport(message, senderId, transactions, periodName);
  } catch (error) {
    console.error(error);
    delete userState[senderId];
    message.reply("Maaf, terjadi kesalahan saat mengambil laporan.");
  }
}

function presentReport(message, senderId, transactions, periodName) {
  // Calculate summary
  let totalIn = 0;
  let totalOut = 0;
  transactions.forEach((tx) => {
    if (tx.type === "IN") totalIn += parseFloat(tx.amount);
    if (tx.type === "OUT") totalOut += parseFloat(tx.amount);
  });

  const summaryMessage = `📊 *Laporan Keuangan - ${periodName}*

💰 *Pemasukan:* Rp${new Intl.NumberFormat("id-ID").format(totalIn)}
💸 *Pengeluaran:* Rp${new Intl.NumberFormat("id-ID").format(totalOut)}
---------------------
📈 *Bersih:* Rp${new Intl.NumberFormat("id-ID").format(totalIn - totalOut)}

Balas "detail" untuk melihat rincian transaksi.`;

  message.reply(summaryMessage);

  // Update state for detail request
  userState[senderId] = {
    step: "awaiting_detail_request",
    transactions: transactions,
  };
}

async function handleDetailRequest(message, senderId) {
  const transactions = userState[senderId].transactions;
  let detailMessage = "📜 *Rincian Transaksi*\n\n";

  transactions.forEach((tx) => {
    const sign = tx.type === "IN" ? "+" : "-";
    const date = new Date(tx.transaction_date).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
    });
    const amount = new Intl.NumberFormat("id-ID").format(tx.amount);

    detailMessage += `*${date}: ${sign}Rp${amount}* (${tx.category} - ${tx.description || "N/A"})\n`;

    // Add itemized details if they exist
    if (tx.items && tx.items.length > 0) {
      tx.items.forEach((item) => {
        const itemPrice = new Intl.NumberFormat("id-ID").format(item.price);
        detailMessage += `  - ${item.item_name} (${item.quantity}x) @ Rp${itemPrice}\n`;
      });
    }
    detailMessage += "\n"; // Add a space between transactions
  });

  message.reply(detailMessage);
  delete userState[senderId]; // End of conversation
}

async function processTransaction(message, senderId) {
  const ctx = await getAccountContextOrReply(message, senderId, true);
  if (!ctx) return;
  let rawText = message.body;
  let mediaFile = null;
  let receiptHash = null;

  if (message.hasMedia) {
    const media = await message.downloadMedia();
    if (media && media.mimetype.startsWith("image/")) {
      mediaFile = media;
      try {
        const buffer = Buffer.from(media.data, "base64");
        receiptHash = crypto.createHash("sha256").update(buffer).digest("hex");
      } catch (e) {
        receiptHash = null;
      }
      try {
        const ocrText = await recognizeText(media.data);
        console.log("--- Raw OCR Text ---");
        console.log(ocrText || "[No text found]");
        console.log("--------------------");
        rawText = `${rawText} ${ocrText}`;
      } catch (error) {
        return message.reply("Maaf, gagal memproses gambar.");
      }
    }
  }

  if (rawText.trim().length === 0) {
    if (mediaFile) {
      // This case happens when an image is sent but OCR finds no text.
      return message.reply(
        "Maaf, tidak ada teks yang bisa dibaca dari gambar tersebut. Coba foto dengan lebih jelas.",
      );
    }
    return; // Ignore empty messages without media
  }

  try {
    // Split message into potential separate transactions
    const parts = splitIntoTransactions(rawText);
    const transactions = [];

    // Save receipt once if media exists
    const receiptPath = mediaFile ? await saveReceipt(mediaFile) : null;
    const dup = receiptHash ? await findTransactionByReceiptHash(ctx.accountId, receiptHash) : null;

    for (const part of parts) {
      try {
        const structuredData = await structureText(part);

        // Skip if AI says it's not a transaction
        if (structuredData.error && structuredData.error === "Bukan transaksi") {
          console.log(`AI determined the text is not a transaction: "${part}"`);
          continue;
        }

        structuredData.receipt_path = receiptPath;
        structuredData.receipt_hash = receiptHash;
        if (!structuredData.transaction_date) {
          structuredData.transaction_date = new Date().toISOString().slice(0, 10);
        }

        transactions.push(structuredData);
      } catch (error) {
        console.error(`Failed to process part: "${part}"`, error);
        // Continue with other parts
      }
    }

    if (transactions.length === 0) {
      // No valid transactions found
      return message.reply("Tidak ada transaksi yang bisa dicatat dari pesan ini.");
    }

    userState[senderId] = {
      step: "awaiting_tx_confirmation",
      accountId: ctx.accountId,
      receiptPath,
      receiptHash,
      duplicate: dup,
      transactions,
    };
    await sendPendingTransactionPreview(message, senderId);
  } catch (error) {
    console.error("Full error trace:", error);
    message.reply(
      "Waduh, AI-nya lagi pusing, atau formatnya aneh. Gagal mencatat transaksi.",
    );
  }
}

async function handleTokenShow(message, senderId) {
  try {
    const { token } = await getActiveAccountToken(senderId);
    await message.reply(
      `🔑 Token akun kamu:\n${token}\n\nBagikan token ini kalau orang lain mau monitoring pencatatan kamu.\nMereka bisa kirim: "pakai token ${token}"`,
    );
  } catch (error) {
    await message.reply(error.message || "Gagal mengambil token.");
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("id-ID").format(value);
}

async function sendPendingTransactionPreview(message, senderId) {
  const state = userState[senderId];
  if (!state || state.step !== "awaiting_tx_confirmation") return;
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
      const itemNames = tx.items.map((it) => `${it.item_name} (${it.quantity}x)`).join(", ");
      txt += `- Items: ${itemNames}\n`;
    }
    txt += `\n`;
  });
  txt += `Balas:\n- ok\n- batal\n- lihat\n- ubah transaksi <n> jumlah <angka>\n- ubah transaksi <n> kategori <teks>\n- ubah transaksi <n> keterangan <teks>\n- ubah transaksi <n> tanggal YYYY-MM-DD`;
  await message.reply(txt);
}

async function handlePendingTransactionMessage(message, senderId, messageBody, rawMessageBody, state) {
  if (messageBody === "lihat") {
    await sendPendingTransactionPreview(message, senderId);
    return;
  }

  if (messageBody === "batal" || messageBody === "batalkan" || messageBody === "cancel") {
    delete userState[senderId];
    await message.reply("✅ Dibatalin. Tidak ada transaksi yang disimpan.");
    return;
  }

  if (messageBody === "ok" || messageBody === "ya" || messageBody === "simpan") {
    try {
      for (const tx of state.transactions) {
        await insertTransaction(state.accountId, tx, senderId);
      }
      delete userState[senderId];
      await message.reply(`✅ Disimpan ${state.transactions.length} transaksi.`);
    } catch (e) {
      await message.reply("❌ Gagal menyimpan transaksi.");
    }
    return;
  }

  const match = rawMessageBody.match(/^ubah transaksi\s+(\d+)\s+(jumlah|kategori|keterangan|tanggal)\s+(.+)$/i);
  if (!match) {
    await message.reply('Perintah tidak dikenali. Balas "lihat" untuk lihat preview.');
    return;
  }

  const index = parseInt(match[1], 10);
  const field = match[2].toLowerCase();
  const value = match[3].trim();
  if (!Number.isFinite(index) || index < 1 || index > state.transactions.length) {
    await message.reply("Nomor transaksi tidak valid.");
    return;
  }
  const tx = state.transactions[index - 1];
  if (field === "jumlah") {
    const amount = parseInt(value.replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(amount)) {
      await message.reply("Jumlah tidak valid.");
      return;
    }
    tx.nominal = amount;
  } else if (field === "kategori") {
    tx.kategori = value;
  } else if (field === "keterangan") {
    tx.keterangan = value;
  } else if (field === "tanggal") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      await message.reply("Format tanggal harus YYYY-MM-DD.");
      return;
    }
    tx.transaction_date = value;
  }
  await sendPendingTransactionPreview(message, senderId);
}

async function handleHelp(message, senderId) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const mode = ctx.canWrite ? "owner" : "monitor";
  let txt = `📌 *Menu (${mode})*\n\n`;
  txt += `- laporan\n- detail (saat diminta)\n- cari <keyword>\n- export <periode>\n- struk terakhir\n\n`;
  if (ctx.canWrite) {
    txt += `- kirim teks transaksi atau foto struk\n- undo / batal\n- edit transaksi terakhir jumlah <angka>\n- set currency <IDR|USD|EUR>\n\n`;
    txt += `- budget set <kategori> <jumlah>\n- budget list\n\n`;
    txt += `- ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>\n- ulang list\n- ulang hapus <id>\n\n`;
    txt += `- token\n- token reset\n- invite\n- invite editor\n- invite list\n- invite cabut <id>\n- akses list\n- akses cabut <user_id>\n`;
  } else {
    txt += `- monitor off\n`;
  }
  await message.reply(txt);
}

async function handleLastReceipt(message, senderId) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const last = await getLastReceiptTransaction(ctx.accountId);
  if (!last || !last.receipt_path) {
    await message.reply("Tidak ada struk yang tersimpan.");
    return;
  }
  const relative = last.receipt_path.startsWith("/") ? last.receipt_path.slice(1) : last.receipt_path;
  const filePath = path.join(__dirname, "..", "public", relative);
  if (!fs.existsSync(filePath)) {
    await message.reply("File struk tidak ditemukan di server.");
    return;
  }
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(senderId, media, { sendMediaAsDocument: true, caption: `Struk transaksi ID ${last.id}` });
}

async function handleExport(message, senderId, rawMessageBody) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const userCurrency = await getUserCurrency(senderId);
  const arg = rawMessageBody.replace(/^export(\s+csv)?/i, "").trim();
  const normalized = arg.toLowerCase();
  let startDate = null;
  let endDate = null;
  let title = "Export";

  if (!arg || normalized === "bulan ini") {
    const dr = getDateRange("bulan ini");
    startDate = dr.startDate;
    endDate = dr.endDate;
    title = "Bulan Ini";
  } else if (normalized.match(/^(1|10)$/) || normalized.includes("10 transaksi")) {
    const last = await getLastTransactions(ctx.accountId, 10, userCurrency);
    await sendCsvFromTransactions(message, senderId, last, `10 Transaksi Terakhir`);
    return;
  } else {
    const dr = getDateRange(arg);
    if (!dr.startDate) {
      await message.reply('Periode tidak valid. Contoh: "export bulan ini" atau "export 3 hari terakhir"');
      return;
    }
    startDate = dr.startDate;
    endDate = dr.endDate;
    title = dr.periodName;
  }

  const rows = await getTransactionsForExport(ctx.accountId, startDate, endDate);
  if (rows.length === 0) {
    await message.reply("Tidak ada transaksi untuk diexport.");
    return;
  }
  await sendCsvFromTransactions(message, senderId, rows, title);
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function sendCsvFromTransactions(message, senderId, txRows, title) {
  const header = ["date", "type", "amount", "currency", "category", "description", "items", "receipt_path"];
  const lines = [header.join(",")];
  txRows.forEach((tx) => {
    const items = (tx.items || [])
      .map((it) => `${it.item_name} x${it.quantity} @${it.price}`)
      .join(" | ");
    const row = [
      tx.transaction_date,
      tx.type,
      tx.amount,
      tx.currency || "IDR",
      tx.category,
      tx.description || "",
      items,
      tx.receipt_path || "",
    ].map(escapeCsv);
    lines.push(row.join(","));
  });
  const csv = lines.join("\n");
  if (csv.length < 55000) {
    await message.reply(`📄 *CSV Export - ${title}*\n\n${csv}`);
    return;
  }
  const fileName = `export-${Date.now()}.csv`;
  const dir = path.join(__dirname, "..", "public", "uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, csv);
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(senderId, media, { sendMediaAsDocument: true, caption: `CSV Export - ${title}` });
}

async function handleBudget(message, senderId, rawMessageBody) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const parts = rawMessageBody.trim().split(/\s+/);
  const cmd = (parts[1] || "").toLowerCase();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const userCurrency = await getUserCurrency(senderId);

  if (cmd === "set") {
    if (!ctx.canWrite) {
      await message.reply('Mode monitoring tidak bisa set budget. Kirim "monitor off" dulu.');
      return;
    }
    const tail = rawMessageBody.replace(/^budget\s+set\s+/i, "").trim();
    const m = tail.match(/^(.*)\s+(\d[\d.,]*)$/);
    if (!m) {
      await message.reply('Format: "budget set <kategori> <jumlah>"');
      return;
    }
    const category = m[1].trim();
    const amount = parseInt(m[2].replace(/[^0-9]/g, ""), 10);
    if (!category || !Number.isFinite(amount)) {
      await message.reply("Kategori/jumlah tidak valid.");
      return;
    }
    await setMonthlyBudget(ctx.accountId, senderId, monthKey, category, amount, userCurrency);
    await message.reply(`✅ Budget diset: ${category} = Rp${formatMoney(amount)} (${monthKey})`);
    return;
  }

  if (cmd === "list" || cmd === "status" || cmd === "") {
    const { startDate, endDate } = (() => {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      return { startDate: start, endDate: end };
    })();
    const budgets = await listMonthlyBudgets(ctx.accountId, monthKey);
    const spend = await getSpendingByCategory(ctx.accountId, startDate, endDate, userCurrency);
    if (budgets.length === 0) {
      await message.reply('Belum ada budget bulan ini. Contoh: "budget set Makan 1500000"');
      return;
    }
    let txt = `📌 *Budget (${monthKey})*\n\n`;
    budgets.forEach((b) => {
      const spent = spend[b.category] || 0;
      const limit = convertCurrencyValue(parseFloat(b.limit_amount), b.currency, userCurrency);
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      txt += `- ${b.category}: Rp${formatMoney(spent)} / Rp${formatMoney(limit)} (${pct}%)\n`;
    });
    await message.reply(txt);
    return;
  }

  await message.reply('Perintah budget: "budget set <kategori> <jumlah>" atau "budget list"');
}

function convertCurrencyValue(amount, fromCurrency, toCurrency) {
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return amount;
  const rates = { IDR: 1, USD: 15000, EUR: 16000 };
  const rateFrom = rates[fromCurrency] || 1;
  const rateTo = rates[toCurrency] || 1;
  const inIdr = amount * rateFrom;
  return inIdr / rateTo;
}

async function handleRecurring(message, senderId, rawMessageBody) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || "").toLowerCase();
  const userCurrency = await getUserCurrency(senderId);

  if (sub === "list") {
    const rules = await listRecurringRules(ctx.accountId);
    if (rules.length === 0) {
      await message.reply('Belum ada transaksi berulang. Contoh: "ulang tambah out 50000 Makan ; makan siang ; 10"');
      return;
    }
    let txt = "🔁 *Transaksi Berulang*\n\n";
    rules.forEach((r) => {
      const status = r.active ? "aktif" : "nonaktif";
      txt += `- ID ${r.id}: ${r.type} Rp${formatMoney(convertCurrencyValue(parseFloat(r.amount), r.currency, userCurrency))} ${r.category} (tgl ${r.day_of_month}) next ${r.next_run_date} (${status})\n`;
    });
    await message.reply(txt);
    return;
  }

  if (sub === "hapus") {
    if (!ctx.canWrite) {
      await message.reply('Mode monitoring tidak bisa ubah recurring. Kirim "monitor off" dulu.');
      return;
    }
    const id = parseInt(parts[2], 10);
    if (!Number.isFinite(id)) {
      await message.reply('Format: "ulang hapus <id>"');
      return;
    }
    await removeRecurringRule(ctx.accountId, senderId, id);
    await message.reply(`✅ Recurring ID ${id} dinonaktifkan.`);
    return;
  }

  if (sub === "tambah") {
    if (!ctx.canWrite) {
      await message.reply('Mode monitoring tidak bisa tambah recurring. Kirim "monitor off" dulu.');
      return;
    }
    const payload = rawMessageBody.replace(/^ulang\s+tambah\s+/i, "").trim();
    const seg = payload.split(";").map((s) => s.trim()).filter(Boolean);
    const first = (seg[0] || "").split(/\s+/);
    const type = (first[0] || "").toUpperCase();
    const amount = parseInt((first[1] || "").replace(/[^0-9]/g, ""), 10);
    const category = first.slice(2).join(" ").trim();
    const description = seg[1] || null;
    const day = seg[2] ? parseInt(seg[2].replace(/[^0-9]/g, ""), 10) : null;
    if (!["IN", "OUT"].includes(type) || !Number.isFinite(amount) || !category || !Number.isFinite(day)) {
      await message.reply('Format: "ulang tambah <in|out> <jumlah> <kategori> ; <keterangan> ; <tgl 1-28>"');
      return;
    }
    const created = await addRecurringRule(ctx.accountId, senderId, {
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

async function handleInvite(message, senderId, rawMessageBody) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || "").toLowerCase();

  if (!ctx.canWrite) {
    await message.reply('Mode monitoring tidak bisa kelola invite. Kirim "monitor off" dulu.');
    return;
  }

  if (sub === "list") {
    try {
      const invites = await listInvites(ctx.accountId, senderId);
      if (invites.length === 0) {
        await message.reply("Belum ada invite.");
        return;
      }
      let txt = "📨 *Invite*\n\n";
      invites.forEach((inv) => {
        const status = inv.revoked_at
          ? "revoked"
          : inv.used_at
            ? `used by ${inv.used_by_user_id}`
            : "active";
        const mode = inv.can_write ? "editor" : "viewer";
        txt += `- ID ${inv.id}: ${mode} (${status})\n  token: ${inv.invite_token}\n`;
      });
      await message.reply(txt);
    } catch (e) {
      await message.reply(e.message || "Gagal ambil invite.");
    }
    return;
  }

  if (sub === "cabut") {
    const id = parseInt(parts[2], 10);
    if (!Number.isFinite(id)) {
      await message.reply('Format: "invite cabut <id>"');
      return;
    }
    try {
      await revokeInvite(ctx.accountId, senderId, id);
      await message.reply(`✅ Invite ID ${id} dicabut.`);
    } catch (e) {
      await message.reply(e.message || "Gagal cabut invite.");
    }
    return;
  }

  const mode = sub === "editor" ? "editor" : "viewer";
  try {
    const created = await createInvite(ctx.accountId, senderId, {
      role: "viewer",
      canWrite: mode === "editor" ? 1 : 0,
      expiresDays: 30,
    });
    await message.reply(
      `✅ Invite dibuat (${mode}).\nToken:\n${created.token}\n\nOrang lain bisa kirim: "pakai token ${created.token}"`,
    );
  } catch (e) {
    await message.reply(e.message || "Gagal membuat invite.");
  }
}

async function handleAccess(message, senderId, rawMessageBody) {
  const ctx = await getAccountContextOrReply(message, senderId, false);
  if (!ctx) return;
  const parts = rawMessageBody.trim().split(/\s+/);
  const sub = (parts[1] || "").toLowerCase();

  if (!ctx.canWrite) {
    await message.reply('Mode monitoring tidak bisa kelola akses. Kirim "monitor off" dulu.');
    return;
  }

  if (sub === "list" || sub === "") {
    try {
      const members = await listMembers(ctx.accountId, senderId);
      if (members.length === 0) {
        await message.reply("Belum ada member.");
        return;
      }
      let txt = "👥 *Akses Akun*\n\n";
      members.forEach((m) => {
        const mode = m.role === "owner" ? "owner" : (m.can_write ? "editor" : "viewer");
        txt += `- ${m.user_id}: ${mode}\n`;
      });
      txt += `\nCabut akses: "akses cabut <user_id>"`;
      await message.reply(txt);
    } catch (e) {
      await message.reply(e.message || "Gagal ambil akses.");
    }
    return;
  }

  if (sub === "cabut") {
    const userId = parts.slice(2).join(" ").trim();
    if (!userId) {
      await message.reply('Format: "akses cabut <user_id>"');
      return;
    }
    try {
      await revokeMember(ctx.accountId, senderId, userId);
      await message.reply(`✅ Akses dicabut untuk ${userId}.`);
    } catch (e) {
      await message.reply(e.message || "Gagal cabut akses.");
    }
    return;
  }

  await message.reply('Perintah akses: "akses list" atau "akses cabut <user_id>"');
}

async function handleTokenReset(message, senderId) {
  try {
    const { token } = await rotateActiveAccountToken(senderId);
    await message.reply(
      `🔁 Token berhasil di-reset.\nToken baru:\n${token}\n\nYang punya token lama tidak bisa akses lagi.`,
    );
  } catch (error) {
    await message.reply(error.message || "Gagal reset token.");
  }
}

async function handleJoinToken(message, senderId, token) {
  if (!token) {
    await message.reply('Format: "pakai token <token>"');
    return;
  }
  try {
    await joinAccountByToken(senderId, token);
    await message.reply(
      '✅ Berhasil masuk ke akun tersebut. Kamu sekarang mode monitoring (read-only). Kirim "monitor off" untuk kembali ke akun kamu.',
    );
  } catch (error) {
    await message.reply(error.message || "Gagal memakai token.");
  }
}

async function handleMonitorOff(message, senderId) {
  try {
    await switchToOwnedAccount(senderId);
    await message.reply("✅ Kembali ke akun kamu.");
  } catch (error) {
    await message.reply(error.message || "Gagal kembali ke akun kamu.");
  }
}

async function handleAccountList(message, senderId) {
  try {
    const accounts = await listUserAccounts(senderId);
    if (accounts.length === 0) {
      await message.reply('Belum ada akun. Kirim "akun baru" untuk membuat pencatatan baru.');
      return;
    }
    let reply = "🗂️ *Daftar akun kamu:*\n\n";
    accounts.forEach((a, idx) => {
      const activeMark = a.isActive ? " (aktif)" : "";
      const mode = a.canWrite ? "owner" : "viewer";
      reply += `${idx + 1}. Akun #${a.accountId} - ${mode}${activeMark}\n`;
    });
    reply += `\nPilih akun: "akun pilih <nomor>"\nBuat akun baru: "akun baru"`;
    await message.reply(reply);
  } catch (error) {
    await message.reply(error.message || "Gagal menampilkan akun.");
  }
}

async function handleAccountNew(message, senderId) {
  try {
    await createAccountAndSetActive(senderId);
    await message.reply(
      '✅ Akun baru dibuat dan dijadikan akun aktif. Kirim "token" untuk lihat token dan share ke orang lain.',
    );
  } catch (error) {
    await message.reply(error.message || "Gagal membuat akun baru.");
  }
}

async function handleAccountPick(message, senderId, idx) {
  if (!Number.isFinite(idx) || idx < 1) {
    await message.reply('Format: "akun pilih <nomor>" (contoh: akun pilih 1)');
    return;
  }
  try {
    const accounts = await listUserAccounts(senderId);
    if (accounts.length === 0) {
      await message.reply('Belum ada akun. Kirim "akun baru" untuk membuat pencatatan baru.');
      return;
    }
    if (idx > accounts.length) {
      await message.reply(`Nomor akun tidak valid. Pilih 1 sampai ${accounts.length}.`);
      return;
    }
    const chosen = accounts[idx - 1];
    await setActiveAccount(senderId, chosen.accountId);
    await message.reply(`✅ Akun aktif diubah ke Akun #${chosen.accountId}.`);
  } catch (error) {
    await message.reply(error.message || "Gagal memilih akun.");
  }
}

// --- Helper Functions ---
function getDateRange(choice) {
  const now = new Date();
  let startDate,
    endDate = now.toISOString().slice(0, 10);
  let periodName = "";

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Normalize choice by removing dots and trimming
  const normalizedChoice = choice.replace(/\./g, "").trim();

  switch (normalizedChoice) {
    case "2":
    case "hari ini":
    case "harian":
      startDate = today.toISOString().slice(0, 10);
      periodName = "Hari Ini";
      break;
    case "3":
    case "3 hari terakhir":
    case "3 hari":
      startDate = new Date(new Date().setDate(today.getDate() - 2))
        .toISOString()
        .slice(0, 10);
      periodName = "3 Hari Terakhir";
      break;
    case "4":
    case "minggu ini":
    case "seminggu":
    case "mingguan":
      startDate = new Date(
        new Date().setDate(
          today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1),
        ),
      )
        .toISOString()
        .slice(0, 10);
      periodName = "Minggu Ini";
      break;
    case "5":
    case "2 minggu terakhir":
    case "2 minggu":
      startDate = new Date(new Date().setDate(today.getDate() - 13))
        .toISOString()
        .slice(0, 10);
      periodName = "2 Minggu Terakhir";
      break;
    case "6":
    case "bulan ini":
    case "1 bulan":
    case "bulanan":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);
      periodName = "Bulan Ini";
      break;
    case "7":
    case "3 bulan terakhir":
    case "3 bulan":
      startDate = new Date(new Date().setMonth(now.getMonth() - 3))
        .toISOString()
        .slice(0, 10);
      periodName = "3 Bulan Terakhir";
      break;
    case "8":
    case "6 bulan terakhir":
    case "6 bulan":
      startDate = new Date(new Date().setMonth(now.getMonth() - 6))
        .toISOString()
        .slice(0, 10);
      periodName = "6 Bulan Terakhir";
      break;
    case "9":
    case "tahun ini":
    case "1 tahun":
      startDate = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      endDate = new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10);
      periodName = "Tahun Ini";
      break;
    default:
      return {};
  }
  return { startDate, endDate, periodName };
}

/**
 * Splits a message into potential separate transactions based on conjunctions.
 * @param {string} text The raw message text.
 * @returns {string[]} Array of substrings each representing a single transaction.
 */
function splitIntoTransactions(text) {
  // Conjunctions that indicate separate transactions
  const conjunctions = [' dan ', ' lalu ', ' kemudian ', ' serta ', ' plus ', ' juga '];
  let parts = [text.trim()];
  // Split by each conjunction iteratively
  conjunctions.forEach(conj => {
    const newParts = [];
    parts.forEach(part => {
      // Split by conjunction, but keep the conjunction as delimiter (remove)
      const split = part.split(conj);
      split.forEach((s, idx) => {
        if (s.trim().length > 0) {
          newParts.push(s.trim());
        }
      });
    });
    parts = newParts;
  });
  // If after splitting we still have only one part, but there's a comma with numbers? Not needed.
  return parts;
}

client.initialize();

console.log("Initializing client...");
