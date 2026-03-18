const { OpenAI } = require('openai');
const config = require('./config');
const crypto = require('crypto');
const LRU = require('lru-cache');

const aiCache = new LRU({
  max: 1000,
  ttl: 86400 * 1000, // 24 hours in milliseconds
});

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getCacheKey(rawText) {
  const normalized = normalizeText(rawText);
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Sends raw text to the AI to be structured into a financial record.
 * @param {string} rawText The raw text from a message or OCR.
 * @returns {Promise<object>} A structured object with keys: tipe, nominal, kategori, keterangan.
 */
async function structureText(rawText) {
  console.log('Sending text to AI for structuring...');

  // Check cache
  const cacheKey = getCacheKey(rawText);
  const cached = aiCache.get(cacheKey);
  if (cached) {
    console.log('Cache hit for:', rawText.substring(0, 50));
    return cached;
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // Helper function for keyword‑based type detection (fallback)
  function detectTypeHint(text) {
    const incomeKeywords = ['gajian', 'gaji', 'salary', 'bonus', 'komisi', 'tip', 'uang masuk', 'terima', 'dapat', 'diterima', 'masuk', 'penjualan', 'jual', 'investasi', 'dividen', 'hibah', 'hadiah', 'refund', 'kembalian', 'reimbursement', 'setoran', 'deposit'];
    const expenseKeywords = ['bayar', 'beli', 'pembayaran', 'pengeluaran', 'keluar', 'out', 'expense', 'shopping', 'makan', 'transport', 'tol', 'parkir', 'listrik', 'pulsa', 'topup'];
    const lowerText = text.toLowerCase();
    const hasIncome = incomeKeywords.some(kw => lowerText.includes(kw));
    const hasExpense = expenseKeywords.some(kw => lowerText.includes(kw));
    if (hasIncome && !hasExpense) return 'IN';
    if (hasExpense && !hasIncome) return 'OUT';
    return null;
  }

  const systemPrompt = `You are an expert financial recording assistant for an Indonesian user. Your task is to extract structured data from messy text from an OCR of a receipt. The output must be a valid JSON object.

Today's date is: ${today.toISOString().slice(0, 10)}.

The JSON object MUST have these keys:
1.  "tipe": string, "OUT" for expenses/receipts, "IN" for income. Infer this from keywords.
   - Income keywords: gajian, gaji, salary, bonus, komisi, tip, uang masuk, terima, dapat, diterima, masuk, penjualan, jual, investasi, dividen, hibah, hadiah, refund, kembalian, reimbursement, setoran, deposit.
   - Expense keywords: bayar, beli, pembayaran, pengeluaran, keluar, out, expense, shopping, makan, transport, tol, parkir, listrik, pulsa, topup.
   - If the text contains any income keyword, classify as "IN". If it contains expense keywords, classify as "OUT". If both present, decide based on context. Default to "OUT" only if no clear indicator.
2.  "nominal": number, the grand total amount, without formatting.
   - If the amount is followed by "ribu", "rb", or "k", multiply by 1000 (e.g., "50 ribu" → 50000).
   - If the amount includes "juta" or "jt", multiply by 1,000,000.
   - If no unit is given and the amount is less than 1000, assume it's in thousands for typical Indonesian transactions (e.g., "beli ayam 50" → 50000).
3.  "kategori": string, infer a relevant category (e.g., "Belanja Bulanan", "Konsumsi", "Elektronik", "Gaji").
4.  "keterangan": string, a brief description (e.g., the name of the store or a summary).
5.  "transaction_date": string, in "YYYY-MM-DD" format. Use the date on the receipt. If no date is on the receipt, use today's date.
6.  "items": An array of objects, where each object represents an item on the receipt. Each object MUST have these keys:
    - "item_name": string, the name of the product.
    - "quantity": number, the quantity of the product purchased. Default to 1 if not specified.
    - "price": number, the total price for that line item (quantity * unit price).

Rules:
- If the text is a simple phrase like "bayar parkir 5000", the "items" array can be empty.
- If the text is a receipt, you MUST extract the items.
- The "nominal" MUST be the grand total. If you sum the items and it doesn't match the total on the receipt, still use the official total for "nominal".
- If the text is a command like "laporan" or any other conversational text that is not a transaction, return a JSON object with a single key "error" with the value "Bukan transaksi".

Example 1 (Simple Text): "bayar tol kemarin 25000"
Output 1: { "tipe": "OUT", "nominal": 25000, "kategori": "Transportasi", "keterangan": "Bayar tol", "transaction_date": "${yesterday.toISOString().slice(0, 10)}", "items": [] }

Example 2 (Receipt Text): "Indomaret Tanggal: 14-03-2026 CHITATO LITE 2x10000 20000 AQUA 600ML 1x3500 3500 TOTAL 23500"
Output 2: { "tipe": "OUT", "nominal": 23500, "kategori": "Belanja Harian", "keterangan": "Indomaret", "transaction_date": "2026-03-14", "items": [ { "item_name": "CHITATO LITE", "quantity": 2, "price": 20000 }, { "item_name": "AQUA 600ML", "quantity": 1, "price": 3500 } ] }

Example 3 (Non-transaction Text): "laporan bulanan dong"
Output 3: { "error": "Bukan transaksi" }

Example 4 (Income Text): "gajian dari kantor 5000000"
Output 4: { "tipe": "IN", "nominal": 5000000, "kategori": "Gaji", "keterangan": "Gajian dari kantor", "transaction_date": "${today.toISOString().slice(0, 10)}", "items": [] }

Example 5 (Income with keyword): "dapat bonus 200000"
Output 5: { "tipe": "IN", "nominal": 200000, "kategori": "Bonus", "keterangan": "Dapat bonus", "transaction_date": "${today.toISOString().slice(0, 10)}", "items": [] }

Example 6 (Amount without unit): "beli ayam 50"
Output 6: { "tipe": "OUT", "nominal": 50000, "kategori": "Makanan", "keterangan": "Beli ayam", "transaction_date": "${today.toISOString().slice(0, 10)}", "items": [] }

Example 7 (Income from sale): "jual laptop 7500000"
Output 7: { "tipe": "IN", "nominal": 7500000, "kategori": "Penjualan", "keterangan": "Jual laptop", "transaction_date": "${today.toISOString().slice(0, 10)}", "items": [] }`;

  const openaiOptions = {
    apiKey: config.ai.apiKey,
  };
  if (config.ai.baseUrl) {
    openaiOptions.baseURL = config.ai.baseUrl;
  }
  const openai = new OpenAI(openaiOptions);

  try {
    const response = await openai.chat.completions.create({
      model: 'deepseek-chat', // Use the appropriate model name for DeepSeek
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawText },
      ],
      response_format: { type: 'json_object' },
    });

    const structuredData = JSON.parse(response.choices[0].message.content);
    
    // Fallback detection: compare AI's tipe with keyword‑based hint
    if (!structuredData.error) {
      const keywordHint = detectTypeHint(rawText);
      if (keywordHint && keywordHint !== structuredData.tipe) {
        console.warn(`⚠️  AI tipe (${structuredData.tipe}) differs from keyword hint (${keywordHint}) for text: "${rawText}"`);
      }
    }
    
    console.log('AI structuring successful:', structuredData);
    // Cache the result
    aiCache.set(cacheKey, structuredData);
    return structuredData;
  } catch (error) {
    console.error('Error during AI structuring:', error);
    throw new Error('Failed to structure text with AI.');
  }
}

module.exports = { structureText };
