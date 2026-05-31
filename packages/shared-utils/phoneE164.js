'use strict';

/**
 * phoneE164.js — Normaliza y valida números de teléfono a formato E.164.
 *
 * E.164 estricto: `+` seguido de 7-15 dígitos, primer dígito 1-9.
 *
 * Acepta entradas con espacios, guiones, paréntesis, puntos y prefijo
 * internacional `00`. Devuelve la forma canónica `+<digits>` o `null` si
 * la entrada no puede mapearse a un E.164 sintácticamente válido.
 *
 * Limitación: no valida códigos de país semánticamente (eso requeriría
 * libphonenumber). Solo asegura sintaxis y un canónico estable para
 * comparaciones UNIQUE en DB.
 */

const E164_RE = /^\+[1-9]\d{6,14}$/;

function normalizePhoneE164(input) {
  if (typeof input !== 'string') return null;
  let cleaned = input.trim();
  if (!cleaned) return null;

  // 00xxxxx → +xxxxx (prefijo internacional común en LATAM/Europa)
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  // Quitar todo lo que no sea dígito o el + inicial
  const hadPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/[^\d]/g, '');
  if (!digits) return null;
  const canonical = `+${digits}`;

  if (!E164_RE.test(canonical)) return null;
  // Si la entrada tenía dígitos sospechosos (empezaba con 0 después del +)
  // ya queda rechazado por el regex. hadPlus solo se usa como pista, no para
  // decidir validez: aceptamos también `573001234567` como `+573001234567`.
  void hadPlus;
  return canonical;
}

function isValidPhoneE164(input) {
  return normalizePhoneE164(input) !== null;
}

module.exports = { normalizePhoneE164, isValidPhoneE164, E164_RE };
