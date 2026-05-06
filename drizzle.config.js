'use strict';

require('dotenv').config();

/** @type {import('drizzle-kit').Config} */
module.exports = {
  schema:   './src/drizzle/schema.js',
  out:      './drizzle/migrations',
  dialect:  'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
};
