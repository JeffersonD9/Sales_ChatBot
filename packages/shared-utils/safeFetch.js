'use strict';

/**
 * safeFetch.js — fetch con defensa SSRF.
 *
 * Reglas:
 *  - Solo http/https.
 *  - Resuelve DNS antes de conectar y rechaza IPs privadas, loopback,
 *    link-local, CGNAT, multicast, broadcast.
 *  - Redirects deshabilitados (redirect: 'manual'); un 3xx aborta.
 *  - Timeout configurable (default 15s).
 *  - Lee el body en streaming y aborta si supera maxBytes; también valida
 *    content-length declarado antes de leer.
 *
 * Limitación conocida: el agente no fuerza la IP resuelta al socket (Node
 * lo vuelve a resolver internamente), así que en teoría hay ventana de DNS
 * rebinding. Para producción crítica, sustituir por un agent custom con
 * `lookup`. La mitigación actual es suficiente para nuestro caso (timeout
 * corto + sin redirects + revalidación en cada call).
 */

const dns = require('dns/promises');
const net = require('net');

// IPv4 CIDRs prohibidas
const PRIVATE_V4_CIDRS = [
  ['0.0.0.0',       8],   // "this network"
  ['10.0.0.0',      8],   // RFC1918
  ['127.0.0.0',     8],   // loopback
  ['169.254.0.0',  16],   // link-local
  ['172.16.0.0',   12],   // RFC1918
  ['192.0.0.0',    24],   // IETF protocol
  ['192.0.2.0',    24],   // documentation
  ['192.168.0.0',  16],   // RFC1918
  ['198.18.0.0',   15],   // benchmark
  ['198.51.100.0', 24],   // documentation
  ['203.0.113.0',  24],   // documentation
  ['224.0.0.0',     4],   // multicast
  ['240.0.0.0',     4],   // reserved
  ['255.255.255.255', 32],
  ['100.64.0.0',   10],   // CGNAT
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
]);

const BLOCKED_TLDS = ['.local', '.internal', '.lan', '.localdomain', '.intra'];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => ((acc << 8) + Number(oct)) >>> 0, 0);
}

function isPrivateIpv4(ip) {
  const num = ipv4ToInt(ip);
  for (const [cidr, bits] of PRIVATE_V4_CIDRS) {
    const base = ipv4ToInt(cidr);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((num & mask) === (base & mask)) return true;
  }
  return false;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase().split('%')[0]; // strip zone id
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80:') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
  }
  // IPv4-mapped without ::ffff: prefix (rare)
  if (lower.includes('.')) {
    const parts = lower.split(':');
    const tail = parts[parts.length - 1];
    if (net.isIPv4(tail)) return isPrivateIpv4(tail);
  }
  return false;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true; // unknown family → rechazar por defensa
}

async function assertSafeHost(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    throw new Error('Hostname inválido');
  }
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) {
    throw new Error('Hostname bloqueado');
  }
  if (BLOCKED_TLDS.some((tld) => lower.endsWith(tld))) {
    throw new Error('Hostname bloqueado por TLD reservado');
  }
  // IP literal
  if (net.isIP(lower)) {
    if (isPrivateIp(lower)) throw new Error('IP privada o reservada no permitida');
    return;
  }
  // DNS lookup — chequear todos los registros
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('Hostname no resoluble');
  }
  if (!records || records.length === 0) {
    throw new Error('Hostname no resoluble');
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new Error('Hostname resuelve a IP privada o reservada');
    }
  }
}

/**
 * Descarga una URL externa con defensa SSRF y límite de tamaño.
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {number} [options.maxBytes=20_971_520]  20 MB
 * @param {number} [options.timeoutMs=15000]
 * @param {string[]} [options.allowedProtocols=['http:','https:']]
 * @returns {Promise<{ buffer: Buffer, status: number, contentType: string }>}
 */
async function safeFetch(rawUrl, options = {}) {
  const {
    maxBytes = 20 * 1024 * 1024,
    timeoutMs = 15000,
    allowedProtocols = ['http:', 'https:'],
  } = options;

  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error('URL inválida');
  }
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`Protocolo no permitido: ${url.protocol}`);
  }

  await assertSafeHost(url.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'whatsapp-saas-safe-fetch/1.0' },
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error('Redirects no permitidos');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
      throw new Error(`Tamaño declarado (${declared} bytes) supera el límite de ${maxBytes}`);
    }

    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) {
      // Sin streaming disponible → fallback al buffer completo, pero ya validamos content-length.
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('Tamaño supera el límite');
      return {
        buffer,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
      };
    }

    const chunks = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { reader.cancel(); } catch { /* noop */ }
        throw new Error(`Tamaño (${total} bytes) supera el límite de ${maxBytes}`);
      }
      chunks.push(Buffer.from(value));
    }
    return {
      buffer: Buffer.concat(chunks, total),
      status: res.status,
      contentType: res.headers.get('content-type') || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { safeFetch, assertSafeHost, isPrivateIp };
