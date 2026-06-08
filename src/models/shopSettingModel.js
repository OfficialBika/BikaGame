'use strict';

const { col } = require('../config/database');

function collection() {
  return col('shop_settings');
}

module.exports = { collection };
