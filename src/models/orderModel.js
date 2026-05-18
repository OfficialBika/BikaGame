const { col } = require('../config/database');
function collection() { return col('orders'); }
module.exports = { collection };
