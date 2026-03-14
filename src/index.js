const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { recognizeText } = require('./ocr');
const { structureText } = require('./ai');
const { insertTransaction, getTransactions, getLastTransactions } = require('./db');
const { saveReceipt } = require('./file-saver');

console.log('Starting WhatsApp client...');

const client = new Client({
    authStrategy: new LocalAuth()
});

// In-memory state management for conversations
const userState = {};

client.on('qr', (qr) => {
    console.log('QR RECEIVED, scan it with your phone');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
});

// --- Main Message Handler ---
client.on('message', async (message) => {
    const senderId = message.from;
    const messageBody = message.body.trim().toLowerCase();

    // Always allow restarting or resetting the conversation flow
    if (messageBody === 'laporan' || messageBody === '/laporan') {
        // If the user was in the middle of something, clear their state.
        if (userState[senderId]) {
            delete userState[senderId];
        }
        await startReportFlow(senderId);
        return; // Stop further processing
    }

    // If the user is in a stateful conversation, handle it
    const currentState = userState[senderId];
    if (currentState) {
        await handleStatefulMessage(message, senderId, messageBody, currentState);
        return;
    }
    
    // Otherwise, process the message as a potential new transaction
    await processTransaction(message);
});

// --- Flow Controllers ---

async function handleStatefulMessage(message, senderId, messageBody, currentState) {
    if (currentState.step === 'awaiting_report_period') {
        await handleReportPeriodSelection(message, senderId, messageBody);
    } else if (currentState.step === 'awaiting_detail_request' && messageBody === 'detail') {
        await handleDetailRequest(message, senderId);
    } else {
        // If the message doesn't match an expected state, reset the state and inform the user.
        delete userState[senderId];
        await message.reply('Perintah tidak dikenali. Kembali ke mode normal. Kirim "laporan" untuk memulai lagi.');
    }
}

async function startReportFlow(senderId) {
    userState[senderId] = { step: 'awaiting_report_period' };
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

async function handleReportPeriodSelection(message, senderId, choice) {
    const normalizedChoice = choice.replace(/\./g, '').trim();

    // Handle "last 10" separately as it doesn't use a date range
    if (normalizedChoice.match(/^(1|10)$/) || choice.match(/10 (transaksi )?terakhir/)) {
        try {
            const transactions = await getLastTransactions(10);
            if (transactions.length === 0) {
                delete userState[senderId];
                return message.reply('Tidak ada transaksi yang ditemukan.');
            }
            // The rest of the logic is the same, so we can reuse it
            return presentReport(message, senderId, transactions, "10 Transaksi Terakhir");
        } catch (error) {
            console.error(error);
            delete userState[senderId];
            return message.reply('Maaf, terjadi kesalahan saat mengambil laporan.');
        }
    }

    const { startDate, endDate, periodName } = getDateRange(normalizedChoice);

    if (!startDate) {
        delete userState[senderId];
        return message.reply('Pilihan tidak valid. Silakan mulai lagi dengan mengirim "laporan".');
    }

    try {
        const transactions = await getTransactions(startDate, endDate);
        if (transactions.length === 0) {
            delete userState[senderId];
            return message.reply(`Tidak ada transaksi yang ditemukan untuk periode "${periodName}".`);
        }
        presentReport(message, senderId, transactions, periodName);

    } catch (error) {
        console.error(error);
        delete userState[senderId];
        message.reply('Maaf, terjadi kesalahan saat mengambil laporan.');
    }
}

function presentReport(message, senderId, transactions, periodName) {
    // Calculate summary
    let totalIn = 0;
    let totalOut = 0;
    transactions.forEach(tx => {
        if (tx.type === 'IN') totalIn += parseFloat(tx.amount);
        if (tx.type === 'OUT') totalOut += parseFloat(tx.amount);
    });

    const summaryMessage = `📊 *Laporan Keuangan - ${periodName}*

💰 *Pemasukan:* Rp${new Intl.NumberFormat('id-ID').format(totalIn)}
💸 *Pengeluaran:* Rp${new Intl.NumberFormat('id-ID').format(totalOut)}
---------------------
📈 *Bersih:* Rp${new Intl.NumberFormat('id-ID').format(totalIn - totalOut)}

Balas "detail" untuk melihat rincian transaksi.`;
    
    message.reply(summaryMessage);

    // Update state for detail request
    userState[senderId] = { 
        step: 'awaiting_detail_request',
        transactions: transactions 
    };
}


async function handleDetailRequest(message, senderId) {
    const transactions = userState[senderId].transactions;
    let detailMessage = '📜 *Rincian Transaksi*\n\n';

    transactions.forEach(tx => {
        const sign = tx.type === 'IN' ? '+' : '-';
        const date = new Date(tx.transaction_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        const amount = new Intl.NumberFormat('id-ID').format(tx.amount);
        
        detailMessage += `*${date}: ${sign}Rp${amount}* (${tx.category} - ${tx.description || 'N/A'})\n`;

        // Add itemized details if they exist
        if (tx.items && tx.items.length > 0) {
            tx.items.forEach(item => {
                const itemPrice = new Intl.NumberFormat('id-ID').format(item.price);
                detailMessage += `  - ${item.item_name} (${item.quantity}x) @ Rp${itemPrice}\n`;
            });
        }
        detailMessage += '\n'; // Add a space between transactions
    });

    message.reply(detailMessage);
    delete userState[senderId]; // End of conversation
}

async function processTransaction(message) {
    let rawText = message.body;
    let mediaFile = null;

    if (message.hasMedia) {
        const media = await message.downloadMedia();
        if (media && media.mimetype.startsWith('image/')) {
            mediaFile = media;
            try {
                const ocrText = await recognizeText(media.data);
                console.log('--- Raw OCR Text ---');
                console.log(ocrText || '[No text found]');
                console.log('--------------------');
                rawText = `${rawText} ${ocrText}`;
            } catch (error) {
                return message.reply('Maaf, gagal memproses gambar.');
            }
        }
    }

    if (rawText.trim().length === 0) {
        if (mediaFile) {
            // This case happens when an image is sent but OCR finds no text.
            return message.reply('Maaf, tidak ada teks yang bisa dibaca dari gambar tersebut. Coba foto dengan lebih jelas.');
        }
        return; // Ignore empty messages without media
    }

    try {
        const structuredData = await structureText(rawText);

        // If the AI identifies the text as not being a transaction, just ignore it.
        if (structuredData.error && structuredData.error === 'Bukan transaksi') {
            console.log('AI determined the text is not a transaction. Ignoring.');
            return;
        }

        structuredData.receipt_path = mediaFile ? await saveReceipt(mediaFile) : null;
        if (!structuredData.transaction_date) {
            structuredData.transaction_date = new Date().toISOString().slice(0, 10);
        }
        
        await insertTransaction(structuredData);

        let confirmationMessage = `✅ *Mantap! Berhasil dicatat:*\n
- *Tipe:* ${structuredData.tipe}
- *Total:* Rp${new Intl.NumberFormat('id-ID').format(structuredData.nominal)}
- *Kategori:* ${structuredData.kategori}
- *Keterangan:* ${structuredData.keterangan}`;

        if (structuredData.items && structuredData.items.length > 0) {
            confirmationMessage += `\n\n*Rincian Barang:*`;
            structuredData.items.forEach(item => {
                confirmationMessage += `\n- ${item.item_name} (${item.quantity}x)`;
            });
        }

        message.reply(confirmationMessage);
    } catch (error) {
        console.error('Full error trace:', error);
        message.reply('Waduh, AI-nya lagi pusing, atau formatnya aneh. Gagal mencatat transaksi.');
    }
}

// --- Helper Functions ---
function getDateRange(choice) {
    const now = new Date();
    let startDate, endDate = now.toISOString().slice(0, 10);
    let periodName = '';

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Normalize choice by removing dots and trimming
    const normalizedChoice = choice.replace(/\./g, '').trim();

    switch (normalizedChoice) {
        case '2':
        case 'hari ini':
        case 'harian':
            startDate = today.toISOString().slice(0, 10);
            periodName = 'Hari Ini';
            break;
        case '3':
        case '3 hari terakhir':
        case '3 hari':
            startDate = new Date(new Date().setDate(today.getDate() - 2)).toISOString().slice(0, 10);
            periodName = '3 Hari Terakhir';
            break;
        case '4':
        case 'minggu ini':
        case 'seminggu':
        case 'mingguan':
            startDate = new Date(new Date().setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1))).toISOString().slice(0, 10);
            periodName = 'Minggu Ini';
            break;
        case '5':
        case '2 minggu terakhir':
        case '2 minggu':
            startDate = new Date(new Date().setDate(today.getDate() - 13)).toISOString().slice(0, 10);
            periodName = '2 Minggu Terakhir';
            break;
        case '6':
        case 'bulan ini':
        case '1 bulan':
        case 'bulanan':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
            periodName = 'Bulan Ini';
            break;
        case '7':
        case '3 bulan terakhir':
        case '3 bulan':
            startDate = new Date(new Date().setMonth(now.getMonth() - 3)).toISOString().slice(0, 10);
            periodName = '3 Bulan Terakhir';
            break;
        case '8':
        case '6 bulan terakhir':
        case '6 bulan':
            startDate = new Date(new Date().setMonth(now.getMonth() - 6)).toISOString().slice(0, 10);
            periodName = '6 Bulan Terakhir';
            break;
        case '9':
        case 'tahun ini':
        case '1 tahun':
            startDate = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
            periodName = 'Tahun Ini';
            break;
        default:
            return {};
    }
    return { startDate, endDate, periodName };
}

client.initialize();

console.log('Initializing client...');
