/**
 * core/whatsapp/parser.js — Funciones puras de parseo de entrada
 * Sin cambios respecto al proyecto original — funciones puras, sin efectos secundarios.
 */

function extractInput(msg) {
  if (!msg || !msg.type) {
    return { type: 'unsupported', text: '', interactiveId: '', interactiveTitle: '' };
  }

  if (msg.type === 'text') {
    return {
      type:             'text',
      text:             msg.text?.body || '',
      interactiveId:    '',
      interactiveTitle: '',
    };
  }

  if (msg.type === 'interactive') {
    const iType = msg.interactive?.type;

    if (iType === 'button_reply') {
      const { id, title } = msg.interactive.button_reply;
      return { type: 'interactive', text: title, interactiveId: id, interactiveTitle: title };
    }

    if (iType === 'list_reply') {
      const { id, title } = msg.interactive.list_reply;
      return { type: 'interactive', text: title, interactiveId: id, interactiveTitle: title };
    }
  }

  return { type: 'unsupported', text: '', interactiveId: '', interactiveTitle: '' };
}

function parseBudget(input) {
  if (!input || typeof input !== 'string') return null;
  const clean = input
    .trim()
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/k$/i, '000');

  const num = parseInt(clean, 10);
  if (isNaN(num) || num < 10000) return null;
  return num;
}

function normalizeTalla(input) {
  if (!input) return null;
  const t = input.toUpperCase().trim();

  const map = {
    XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XL',
    PEQUE\u00d1A: 'S', PEQUE\u00d1O: 'S', CHICO: 'S', CHICA: 'S', PEQUE: 'S',
    MEDIANA: 'M', MEDIANO: 'M', MEDIA: 'M',
    GRANDE: 'L', GRAND: 'L',
    EXTRA: 'XL',
    '6': 'S', '8': 'S',
    '10': 'M', '12': 'M',
    '14': 'L', '16': 'L',
    '18': 'XL', '20': 'XL',
    '26': 'XS', '28': 'S', '30': 'S',
    '32': 'M', '34': 'M',
    '36': 'L', '38': 'L',
    '40': 'XL', '42': 'XL',
  };

  return map[t] || null;
}

module.exports = { extractInput, parseBudget, normalizeTalla };
