function requiredInt(queryValue, name) {
  const n = parseInt(queryValue, 10);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${name} invalid`);
    err.status = 400;
    throw err;
  }
  return n;
}

function optionalInt(queryValue, fallback) {
  const n = parseInt(queryValue, 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function optionalBool(queryValue, fallback = false) {
  if (queryValue === undefined || queryValue === null) return fallback;
  const v = String(queryValue).toLowerCase().trim();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return fallback;
}

function optionalDate(queryValue) {
  if (!queryValue) return null;
  const v = String(queryValue).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const err = new Error('date invalid');
    err.status = 400;
    throw err;
  }
  return v;
}

function optionalMonth(queryValue) {
  if (!queryValue) return null;
  const v = String(queryValue).trim();
  if (!/^\d{4}-\d{2}$/.test(v)) {
    const err = new Error('month invalid');
    err.status = 400;
    throw err;
  }
  return v;
}

function optionalCurrency(queryValue, fallback = 'IDR') {
  if (!queryValue) return fallback;
  const v = String(queryValue).toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(v)) return fallback;
  return v;
}

module.exports = {
  requiredInt,
  optionalInt,
  optionalBool,
  optionalDate,
  optionalMonth,
  optionalCurrency,
};
