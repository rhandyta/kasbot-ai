function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const flushCell = () => {
    row.push(cell);
    cell = '';
  };
  const flushRow = () => {
    if (row.length === 1 && row[0] === '' && rows.length === 0) return;
    rows.push(row);
    row = [];
  };

  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      flushCell();
      continue;
    }
    if (ch === '\n') {
      flushCell();
      flushRow();
      continue;
    }
    if (ch === '\r') {
      continue;
    }
    cell += ch;
  }
  flushCell();
  flushRow();
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/\s+/g, '_').trim();
}

function toYyyyMmDd(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = String(m[1]).padStart(2, '0');
    const mo = String(m[2]).padStart(2, '0');
    return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

function parseAmount(value) {
  const v = String(value || '').replace(/[^0-9.-]/g, '').trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeType(value, amount) {
  const v = String(value || '').toUpperCase().trim();
  if (v === 'IN' || v === 'OUT') return v;
  if (v === 'DEBIT') return 'OUT';
  if (v === 'CREDIT') return 'IN';
  if (v === '+') return 'IN';
  if (v === '-') return 'OUT';
  if (amount !== null && amount !== undefined) {
    if (amount < 0) return 'OUT';
    return 'IN';
  }
  return null;
}

function parseStatementCsv(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];
  const header = rows[0].map(normalizeHeader);
  const idx = (name) => header.indexOf(name);

  const iDate = idx('date');
  const iType = idx('type');
  const iAmount = idx('amount');
  const iCurrency = idx('currency');
  const iCategory = idx('category');
  const iMerchant = idx('merchant');
  const iDescription = idx('description');

  if (iDate === -1 || iAmount === -1) {
    throw new Error('CSV minimal harus punya kolom: date, amount');
  }

  const txs = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const date = toYyyyMmDd(row[iDate]);
    const amountRaw = parseAmount(row[iAmount]);
    if (!date || amountRaw === null) continue;
    const type = normalizeType(iType !== -1 ? row[iType] : null, amountRaw);
    const amount = Math.abs(amountRaw);
    const currency = iCurrency !== -1 ? String(row[iCurrency] || 'IDR').toUpperCase().trim() : 'IDR';
    const category = iCategory !== -1 ? String(row[iCategory] || '').trim() : '';
    const merchant = iMerchant !== -1 ? String(row[iMerchant] || '').trim() : '';
    const description = iDescription !== -1 ? String(row[iDescription] || '').trim() : '';

    txs.push({
      transaction_date: date,
      tipe: type || 'OUT',
      nominal: amount,
      currency: currency || 'IDR',
      kategori: category || 'Uncategorized',
      merchant: merchant || null,
      keterangan: description || merchant || 'Import CSV',
      items: [],
    });
  }
  return txs;
}

module.exports = { parseCsv, parseStatementCsv, toYyyyMmDd, parseAmount };
