function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  const v0 = new Array(t.length + 1);
  const v1 = new Array(t.length + 1);
  for (let i = 0; i <= t.length; i += 1) v0[i] = i;

  for (let i = 0; i < s.length; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < t.length; j += 1) {
      const cost = s[i] === t[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= t.length; j += 1) v0[j] = v1[j];
  }
  return v0[t.length];
}

function normalizeToken(token) {
  return String(token || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function tokenLooksSuspicious(token) {
  const t = normalizeToken(token);
  if (t.length < 3) return false;
  if (/[0-9]/.test(t) && /[A-Z]/.test(t)) return true;
  return /[01IJLO]/.test(t);
}

function fixNumericLike(token) {
  let t = String(token || '');
  t = t.replace(/[Oo]/g, '0');
  t = t.replace(/[Il]/g, '1');
  return t;
}

function fixWeightToken(token) {
  const raw = String(token || '');
  const upper = raw.toUpperCase();
  const m = upper.match(/^([0-9OIL]{1,6})(GR|G|KG|ML|L|LT)$/);
  if (!m) return null;
  const unit = m[2];
  const digitsRaw = m[1];
  const digits = fixNumericLike(digitsRaw);
  if (unit === 'G' && (digits.length < 2 || digits.startsWith('0'))) return null;
  if (unit === 'L' && digits.length === 1 && digits === '0') return null;
  return `${digits}${unit}`;
}

function fixAlphaToken(token) {
  let t = String(token || '').toUpperCase();
  t = t.replace(/0/g, 'O');
  t = t.replace(/1/g, 'I');
  t = t.replace(/2/g, 'Z');
  t = t.replace(/5/g, 'S');
  t = t.replace(/8/g, 'B');
  t = t.replace(/6/g, 'G');
  return t;
}

function buildLexicon() {
  const base = [
    'INDOMARET',
    'ALFAMART',
    'ALFAMIDI',
    'NISSIN',
    'TANGO',
    'BIG',
    'COLA',
    'LEMONIA',
    'MIZONE',
    'QTELA',
    'SEAWEED',
    'TEMPE',
    'VISINE',
    'CHOCO',
    'WAFER',
    'ROYALE',
    'DISKON',
    'TOTAL',
    'NON',
    'TUNAI',
    'PPN',
    'DPP',
    'KEMBALI',
    'HARGA',
    'JUMLAH',
    'BCA',
    'PROMO',
    '700GR',
    '350G',
    '500ML',
    '1L',
    '3L',
  ];
  const extra = String(process.env.OCR_LEXICON_EXTRA || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toUpperCase());
  return Array.from(new Set([...base, ...extra]));
}

const LEXICON = buildLexicon();

function bestLexiconMatch(token) {
  const t = normalizeToken(token);
  if (t.length < 3 || t.length > 12) return null;
  if (!tokenLooksSuspicious(t)) return null;

  let best = null;
  for (const w of LEXICON) {
    if (Math.abs(w.length - t.length) > 3) continue;
    const d = levenshtein(t, w);
    if (!best || d < best.d) best = { w, d };
    if (best && best.d === 0) break;
  }
  if (!best) return null;
  const maxAllowed = Math.min(2, Math.max(1, Math.ceil(t.length * 0.28)));
  if (best.d <= maxAllowed) return best.w;
  return null;
}

function postProcessLine(line) {
  const parts = String(line || '').split(/(\s+)/);
  const out = parts.map((p) => {
    if (/^\s+$/.test(p) || p.length === 0) return p;
    const raw = p;
    const cleaned = normalizeToken(raw);
    if (cleaned.length === 0) return raw;

    const weightFixed = fixWeightToken(cleaned);
    if (weightFixed) return weightFixed;

    let candidate = cleaned;
    if (/[0-9]/.test(candidate) && /[A-Z]/.test(candidate)) {
      candidate = fixAlphaToken(candidate);
    }

    const lex = bestLexiconMatch(candidate);
    if (lex) return lex;

    const lex2 = bestLexiconMatch(cleaned);
    if (lex2) return lex2;

    return candidate;
  });
  return out.join('');
}

function postProcessOcrText(text) {
  const lines = String(text || '').split('\n');
  const processed = lines.map((l) => postProcessLine(l));
  return processed.join('\n').trim();
}

module.exports = { postProcessOcrText, levenshtein };
