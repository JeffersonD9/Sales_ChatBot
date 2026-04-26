/**
 * crypto.js — Encriptación/desencriptación de tokens sensibles
 *
 * Los tokens de WhatsApp se guardan encriptados en la BD con AES-256-CBC.
 * La llave viene de ENCRYPTION_KEY (32 bytes en hex = 64 chars).
 *
 * Formato del valor encriptado: "{iv_hex}:{cipher_hex}"
 */

const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');

const ALGO = 'aes-256-cbc';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encripta un texto plano. Retorna "{iv}:{cipher}" en hex.
 * @param {string} text
 * @returns {string}
 */
function encrypt(text) {
  if (!text) return '';
  const key = getKey();
  const iv  = randomBytes(16);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Desencripta un valor producido por encrypt().
 * @param {string} encryptedText - Formato "{iv}:{cipher}"
 * @returns {string}
 */
function decrypt(encryptedText) {
  if (!encryptedText) return '';
  const [ivHex, cipherHex] = encryptedText.split(':');
  if (!ivHex || !cipherHex) return '';
  const key = getKey();
  const iv  = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
