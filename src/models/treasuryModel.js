const { col } = require('../config/database');
function collection() { return col('config'); }
module.exports = { collection };
