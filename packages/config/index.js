'use strict';

require('dotenv').config();

const infra = require('./infra');
const { validateEnv } = require('./validateEnv');

function getEnv(name, fallback = undefined) {
  return process.env[name] || fallback;
}

module.exports = {
  ...infra,
  getEnv,
  validateEnv,
};
