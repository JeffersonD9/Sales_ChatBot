/**
 * crypto.js — Encriptación/desencriptación de tokens sensibles
 *
 * Los tokens de WhatsApp se guardan encriptados en la BD con AES-256-GCM.
 * La llave viene de ENCRYPTION_KEY (32 bytes en hex = 64 chars).
 *
 * Formato nuevo (GCM):  "{iv_hex}:{authTag_hex}:{cipher_hex}"  — 3 partes
 * Formato legado (CBC): "{iv_hex}:{cipher_hex}"                — 2 partes
 *
 * decrypt() detecta el formato automaticamente para permitir compatibilidad
 * temporal con tokens antiguos. encrypt() siempre produce GCM.
 */

const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const { logger } = require('@whatsapp-saas/logger');

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encripta un texto plano con AES-256-GCM.
 * Retorna "{iv_hex}:{authTag_hex}:{cipher_hex}".
 * @param {string} text
 * @returns {string}
 */
function encrypt(text) {
  if (!text) return '';
  const key    = getKey();
  const iv     = randomBytes(12); // 96 bits — estándar recomendado para GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Desencripta un valor producido por encrypt().
 * Soporta tanto el formato GCM nuevo (3 partes) como el CBC legado (2 partes).
 * @param {string} encryptedText
 * @returns {string}
 */
function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');

    if (parts.length === 3) {
      // Formato GCM: iv:authTag:cipher
      const [ivHex, authTagHex, cipherHex] = parts;
      const key     = getKey();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      return Buffer.concat([
        decipher.update(Buffer.from(cipherHex, 'hex')),
        decipher.final(),
      ]).toString('utf8');
    }

    // Formato legado CBC: iv:cipher — solo para tokens creados antes de la migración
    const [ivHex, cipherHex] = parts;
    if (!ivHex || !cipherHex) return '';
    const key     = getKey();
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    logger.error({ err: err.message }, '[Crypto] Error desencriptando — verificar ENCRYPTION_KEY o formato');
    return '';
  }
}

module.exports = { encrypt, decrypt };
