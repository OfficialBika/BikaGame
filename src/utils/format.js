function escHtml(s){ return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function fmt(n){ const x=typeof n==='string'?Number(n.replace(/,/g,'')):Number(n||0); return Number.isFinite(x)?x.toLocaleString('en-US'):'0'; }
function toNum(v){ if(typeof v==='number') return v; if(typeof v==='string') return Number(v.replace(/,/g,''))||0; return 0; }
function formatYangon(dt=new Date()){ try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yangon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(dt);}catch{return dt.toISOString();} }
function uptime(total){ const s=Math.max(0,Math.floor(Number(total)||0)); const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60), sec=s%60; return [d&&`${d}d`,(h||d)&&`${h}h`,(m||h||d)&&`${m}m`,`${sec}s`].filter(Boolean).join(' '); }
module.exports = { escHtml, fmt, toNum, formatYangon, uptime };
