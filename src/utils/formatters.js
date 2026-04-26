/**
 * formatters.js — Funciones puras de formateo (sin cambios del original)
 */

function formatPrice(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '$0';
  return `$${amount.toLocaleString('es-CO')}`;
}

function formatPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return `+${digits}`;
}

function capitalizeName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function truncate(text, maxLength = 20) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '\u2026' : text;
}

module.exports = { formatPrice, formatPhone, capitalizeName, truncate };
