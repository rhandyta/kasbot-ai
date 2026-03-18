function isGroupChatId(chatId) {
  return typeof chatId === 'string' && chatId.endsWith('@g.us');
}

function formatMoney(value) {
  return new Intl.NumberFormat('id-ID').format(value);
}

function getDateRange(choice) {
  const now = new Date();
  let startDate;
  let endDate = now.toISOString().slice(0, 10);
  let periodName = '';

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
      startDate = new Date(new Date().setDate(today.getDate() - 2))
        .toISOString()
        .slice(0, 10);
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
      )
        .toISOString()
        .slice(0, 10);
      periodName = 'Minggu Ini';
      break;
    case '5':
    case '2 minggu terakhir':
    case '2 minggu':
      startDate = new Date(new Date().setDate(today.getDate() - 13))
        .toISOString()
        .slice(0, 10);
      periodName = '2 Minggu Terakhir';
      break;
    case '6':
    case 'bulan ini':
    case '1 bulan':
    case 'bulanan':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);
      periodName = 'Bulan Ini';
      break;
    case '7':
    case '3 bulan terakhir':
    case '3 bulan':
      startDate = new Date(new Date().setMonth(now.getMonth() - 3))
        .toISOString()
        .slice(0, 10);
      periodName = '3 Bulan Terakhir';
      break;
    case '8':
    case '6 bulan terakhir':
    case '6 bulan':
      startDate = new Date(new Date().setMonth(now.getMonth() - 6))
        .toISOString()
        .slice(0, 10);
      periodName = '6 Bulan Terakhir';
      break;
    case '9':
    case 'tahun ini':
    case '1 tahun':
      startDate = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      endDate = new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10);
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

module.exports = { isGroupChatId, formatMoney, getDateRange, splitIntoTransactions };
