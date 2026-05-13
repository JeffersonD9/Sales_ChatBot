'use strict';
require('dotenv').config();
const { decrypt } = require('@whatsapp-saas/shared-utils');
const { db }      = require('../packages/platform-data');

const { query } = db;

(async () => {
  try {
    const r     = await query('SELECT wa_token_encrypted FROM tenants WHERE slug = $1', ['miguel-test']);
    const token = decrypt(r.rows[0].wa_token_encrypted);
    console.log('TOKEN_LENGTH :', token.length);
    console.log('TOKEN_START  :', token.substring(0, 8) + '...');
    console.log('IS_DEMO      :', token === 'DEMO_TOKEN');
    console.log('IS_EMPTY     :', token === '');
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
})();
