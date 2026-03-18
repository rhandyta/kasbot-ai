function getInteractiveTypes() {
  try {
    const wweb = require('whatsapp-web.js');
    const Buttons = wweb.Buttons;
    const List = wweb.List;
    return { Buttons, List };
  } catch {
    return { Buttons: null, List: null };
  }
}

function extractInteractiveId(message) {
  const type = message?.type;
  if (type === 'buttons_response') {
    return message?.selectedButtonId || null;
  }
  if (type === 'list_response') {
    return message?.selectedRowId || null;
  }
  return null;
}

function createButtons(body, buttons, title, footer) {
  const { Buttons } = getInteractiveTypes();
  if (!Buttons) return null;
  try {
    return new Buttons(body, buttons, title, footer);
  } catch {
    return null;
  }
}

function createList(body, buttonText, sections, title, footer) {
  const { List } = getInteractiveTypes();
  if (!List) return null;
  try {
    return new List(body, buttonText, sections, title, footer);
  } catch {
    return null;
  }
}

module.exports = { getInteractiveTypes, extractInteractiveId, createButtons, createList };
