function positiveInt(v){ const n=Number(String(v).replace(/,/g,'')); return Number.isFinite(n)&&n>0?Math.floor(n):null; }
module.exports = { positiveInt };
