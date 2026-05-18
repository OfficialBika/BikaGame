const { col } = require('../config/database');
function collection() { return col('groups'); }
module.exports = { collection };
