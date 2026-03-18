const { OpenAI } = require('openai');
const config = require('./config');

const openai = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseUrl,
});

/**
 * Sends raw text to the AI to be structured into a financial record.
 * @param {string} rawText The raw text from a message or OCR.
 * @returns {Promise<object>} A structured object with keys: tipe, nominal, kategori, keterangan.
 */
async function structureText(rawText) {
  console.log('Sending text to AI for structuring...');
  
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const systemPrompt = `You are an expert financial recording assistant for an Indonesian user. Your task is to extract structured data from messy text from an OCR of a receipt. The output must be a valid JSON object.

Today's date is: ${today.toISOString().slice(0, 10)}.

The JSON object MUST have these keys:
1.  "tipe": string, "OUT" for expenses/receipts, "IN" for income. Infer this from keywords like "gajian", "terima", "dapat uang", etc. for "IN". Default to "OUT" if ambiguous.
2.  "nominal": number, the grand total amount, without formatting.
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
Output 4: { "tipe": "IN", "nominal": 5000000, "kategori": "Gaji", "keterangan": "Gajian dari kantor", "transaction_date": "${today.toISOString().slice(0, 10)}", "items": [] }`;

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
    console.log('AI structuring successful:', structuredData);
    return structuredData;
  } catch (error) {
    console.error('Error during AI structuring:', error);
    throw new Error('Failed to structure text with AI.');
  }
}

module.exports = { structureText };
