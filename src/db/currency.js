function convertAmount(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const rates = {
    IDR: 1,
    USD: 15000,
    EUR: 16000,
  };
  const rateFrom = rates[fromCurrency] || 1;
  const rateTo = rates[toCurrency] || 1;
  const amountInIDR = amount * rateFrom;
  return amountInIDR / rateTo;
}

module.exports = { convertAmount };
