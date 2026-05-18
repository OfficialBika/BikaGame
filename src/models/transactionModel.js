const { col } = require('../config/database');
function collection() { return col('transactions'); }
module.exports = { collection };
