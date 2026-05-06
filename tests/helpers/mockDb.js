'use strict';

/**
 * tests/helpers/mockDb.js — Mock del cliente Drizzle para tests unitarios
 *
 * Uso:
 *   const { createMockDb } = require('../../helpers/mockDb');
 *   jest.mock('../../../src/drizzle/db', () => ({ getDb: () => mockDb }));
 *   const mockDb = createMockDb();
 *
 * Encola resultados con mockDb._enqueue(result).
 * Cada operación awaitable (await de la cadena, .execute()) desencola un resultado.
 *
 * Formato:
 *   - SELECT: encolar un array [] con las filas
 *   - INSERT/UPDATE .returning(): encolar un array [] con las filas
 *   - .execute(): encolar { rows: [], rowCount: 0 }
 */

function createMockDb() {
  const _queue = [];

  function dequeue() {
    if (_queue.length === 0) return [];
    return _queue.shift();
  }

  // El chain es un thenable: `await chain` llama a `.then()`
  // Esto permite hacer `await db.select().from().where().limit(1)` sin
  // tener que mockear cada método terminal por separado.
  const chain = {
    // Thenability — para await directo de la cadena
    then(resolve, reject) {
      return Promise.resolve(dequeue()).then(resolve, reject);
    },
    catch(fn) { return this.then(undefined, fn); },

    // Chainable methods — todos retornan el mismo chain
    select:             jest.fn().mockReturnThis(),
    from:               jest.fn().mockReturnThis(),
    where:              jest.fn().mockReturnThis(),
    limit:              jest.fn().mockReturnThis(),
    orderBy:            jest.fn().mockReturnThis(),
    innerJoin:          jest.fn().mockReturnThis(),
    insert:             jest.fn().mockReturnThis(),
    values:             jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    returning:          jest.fn().mockReturnThis(),
    update:             jest.fn().mockReturnThis(),
    set:                jest.fn().mockReturnThis(),
    delete:             jest.fn().mockReturnThis(),

    // execute: para SQL raw — retorna { rows, rowCount }
    execute: jest.fn().mockImplementation(() => Promise.resolve(dequeue())),

    // transaction: ejecuta el callback con el mismo chain
    transaction: jest.fn().mockImplementation(async (fn) => fn(chain)),

    // Helper para encolar resultados desde los tests
    _enqueue(...results) {
      _queue.push(...results);
      return chain;
    },
    _clearQueue() {
      _queue.length = 0;
      return chain;
    },
  };

  return chain;
}

module.exports = { createMockDb };
