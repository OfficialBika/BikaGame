function stamp(){ return new Date().toISOString(); }
function line(level, args){ console.log(`[${stamp()}] [${level}]`, ...args); }
module.exports = { info:(...a)=>line('INFO',a), warn:(...a)=>line('WARN',a), error:(...a)=>line('ERROR',a), debug:(...a)=>{ if(process.env.DEBUG) line('DEBUG',a); } };
