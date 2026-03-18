function isGroupChatId(chatId) {
  return typeof chatId === 'string' && chatId.endsWith('@g.us');
}

function formatMoney(value) {
  return new Intl.NumberFormat('id-ID').format(value);
}

function formatDateYyyyMmDd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateRange(choice) {
  const now = new Date();
  let startDate;
  let endDate = formatDateYyyyMmDd(now);
  let periodName = '';

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const normalizedChoice = choice.replace(/\./g, '').trim();

  switch (normalizedChoice) {
    case '2':
    case 'hari ini':
    case 'harian':
      startDate = formatDateYyyyMmDd(today);
      periodName = 'Hari Ini';
      break;
    case '3':
    case '3 hari terakhir':
    case '3 hari':
      startDate = new Date(new Date().setDate(today.getDate() - 2))
      startDate = formatDateYyyyMmDd(startDate);
      periodName = '3 Hari Terakhir';
      break;
    case '4':
    case 'minggu ini':
    case 'seminggu':
    case 'mingguan':
      startDate = new Date(
        new Date().setDate(
          today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1),
        ),
      );
      startDate = formatDateYyyyMmDd(startDate);
      periodName = 'Minggu Ini';
      break;
    case '5':
    case '2 minggu terakhir':
    case '2 minggu':
      startDate = new Date(new Date().setDate(today.getDate() - 13))
      startDate = formatDateYyyyMmDd(startDate);
      periodName = '2 Minggu Terakhir';
      break;
    case '6':
    case 'bulan ini':
    case '1 bulan':
    case 'bulanan':
      startDate = formatDateYyyyMmDd(new Date(now.getFullYear(), now.getMonth(), 1));
      endDate = formatDateYyyyMmDd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      periodName = 'Bulan Ini';
      break;
    case '7':
    case '3 bulan terakhir':
    case '3 bulan':
      startDate = new Date(new Date().setMonth(now.getMonth() - 3))
      startDate = formatDateYyyyMmDd(startDate);
      periodName = '3 Bulan Terakhir';
      break;
    case '8':
    case '6 bulan terakhir':
    case '6 bulan':
      startDate = new Date(new Date().setMonth(now.getMonth() - 6))
      startDate = formatDateYyyyMmDd(startDate);
      periodName = '6 Bulan Terakhir';
      break;
    case '9':
    case 'tahun ini':
    case '1 tahun':
      startDate = formatDateYyyyMmDd(new Date(now.getFullYear(), 0, 1));
      endDate = formatDateYyyyMmDd(new Date(now.getFullYear(), 11, 31));
      periodName = 'Tahun Ini';
      break;
    default:
      return {};
  }

  return { startDate, endDate, periodName };
}

function splitIntoTransactions(text) {
  const conjunctions = [' dan ', ' lalu ', ' kemudian ', ' serta ', ' plus ', ' juga '];
  let parts = [text.trim()];
  conjunctions.forEach((conj) => {
    const newParts = [];
    parts.forEach((part) => {
      part
        .split(conj)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => newParts.push(s));
    });
    parts = newParts;
  });
  return parts;
}

module.exports = { isGroupChatId, formatMoney, formatDateYyyyMmDd, getDateRange, splitIntoTransactions };
