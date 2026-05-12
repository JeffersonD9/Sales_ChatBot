'use strict';

require('dotenv').config();

const { validateEnv } = require('../utils/validateEnv');

function getEnv(name, fallback = undefined) {
  return process.env[name] || fallback;
}

module.exports = {
  getEnv,
  validateEnv,
};
