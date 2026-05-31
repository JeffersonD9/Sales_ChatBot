'use strict';

const { assertSafeHost, isPrivateIp, safeFetch } = require('../../../packages/shared-utils/safeFetch');

describe('safeFetch — defensa SSRF', () => {
  describe('isPrivateIp', () => {
    test('IPv4 loopback', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('127.255.255.254')).toBe(true);
    });
    test('IPv4 RFC1918', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
    });
    test('IPv4 link-local', () => {
      expect(isPrivateIp('169.254.169.254')).toBe(true); // AWS metadata
    });
    test('IPv4 CGNAT', () => {
      expect(isPrivateIp('100.64.0.1')).toBe(true);
    });
    test('IPv4 públicas', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('1.1.1.1')).toBe(false);
      expect(isPrivateIp('177.7.58.11')).toBe(false);
    });
    test('IPv6 loopback y ULA', () => {
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('fc00::1')).toBe(true);
      expect(isPrivateIp('fd00::1')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);
    });
    test('IPv4-mapped en IPv6', () => {
      expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    });
    test('formato inválido → true (defensa)', () => {
      expect(isPrivateIp('not-an-ip')).toBe(true);
    });
  });

  describe('assertSafeHost', () => {
    test('rechaza localhost', async () => {
      await expect(assertSafeHost('localhost')).rejects.toThrow(/bloqueado/i);
    });
    test('rechaza TLDs reservados', async () => {
      await expect(assertSafeHost('foo.local')).rejects.toThrow(/bloqueado/i);
      await expect(assertSafeHost('host.internal')).rejects.toThrow(/bloqueado/i);
    });
    test('rechaza IPs privadas literales', async () => {
      await expect(assertSafeHost('127.0.0.1')).rejects.toThrow(/privada/i);
      await expect(assertSafeHost('169.254.169.254')).rejects.toThrow(/privada/i);
      await expect(assertSafeHost('10.0.0.1')).rejects.toThrow(/privada/i);
    });
    test('rechaza IPv6 ULA', async () => {
      await expect(assertSafeHost('::1')).rejects.toThrow(/privada/i);
    });
  });

  describe('safeFetch — protocolo y URL', () => {
    test('rechaza file://', async () => {
      await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/Protocolo/);
    });
    test('rechaza javascript:', async () => {
      await expect(safeFetch('javascript:alert(1)')).rejects.toThrow(/Protocolo/);
    });
    test('rechaza data:', async () => {
      await expect(safeFetch('data:text/plain,foo')).rejects.toThrow(/Protocolo/);
    });
    test('rechaza URL inválida', async () => {
      await expect(safeFetch('not a url')).rejects.toThrow(/URL inválida/);
    });
    test('rechaza http://localhost', async () => {
      await expect(safeFetch('http://localhost/x')).rejects.toThrow(/bloqueado/i);
    });
    test('rechaza http://169.254.169.254 (AWS metadata)', async () => {
      await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        /privada/i,
      );
    });
    test('rechaza http://10.0.0.1', async () => {
      await expect(safeFetch('http://10.0.0.1/')).rejects.toThrow(/privada/i);
    });
  });
});
