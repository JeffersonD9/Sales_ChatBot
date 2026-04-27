'use strict';

const { formatPrice, formatPhone, capitalizeName } = require('../../../src/utils/formatters');

describe('formatPrice', () => {
  it('formatea numero en pesos colombianos', () => {
    expect(formatPrice(80000)).toMatch(/80/);
  });

  it('retorna $0 para 0', () => {
    expect(formatPrice(0)).toBe('$0');
  });

  it('retorna $0 para NaN', () => {
    expect(formatPrice(NaN)).toBe('$0');
  });

  it('retorna $0 para string', () => {
    expect(formatPrice('hola')).toBe('$0');
  });
});

describe('formatPhone', () => {
  it('agrega + al numero', () => {
    expect(formatPhone('573001234567')).toBe('+573001234567');
  });

  it('elimina caracteres no numericos', () => {
    expect(formatPhone('+57 300 123 4567')).toBe('+573001234567');
  });

  it('retorna string vacio para null', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('')).toBe('');
  });
});

describe('capitalizeName', () => {
  it('capitaliza cada palabra', () => {
    expect(capitalizeName('pedro perez')).toBe('Pedro Perez');
  });

  it('maneja multiples espacios', () => {
    expect(capitalizeName('  ana   maria  ')).toBe('Ana Maria');
  });

  it('convierte mayusculas a title case', () => {
    expect(capitalizeName('JUAN CARLOS')).toBe('Juan Carlos');
  });

  it('retorna string vacio para null/undefined', () => {
    expect(capitalizeName(null)).toBe('');
    expect(capitalizeName(undefined)).toBe('');
  });
});
