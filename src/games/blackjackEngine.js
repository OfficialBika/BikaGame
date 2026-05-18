const SUITS=['♠','♥','♦','♣']; const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function deck(){ const d=[]; for(const s of SUITS)for(const r of RANKS)d.push({rank:r,suit:s}); return d.sort(()=>Math.random()-0.5); }
function value(cards){ let total=0,aces=0; for(const c of cards){ if(c.rank==='A'){aces++; total+=11;} else if(['J','Q','K'].includes(c.rank)) total+=10; else total+=Number(c.rank); } while(total>21&&aces){ total-=10; aces--; } return total; }
function play(){ const d=deck(); const player=[d.pop(),d.pop()], dealer=[d.pop(),d.pop()]; while(value(dealer)<17) dealer.push(d.pop()); const pv=value(player), dv=value(dealer); let result='LOSE'; if(pv===21&&player.length===2) result='BLACKJACK'; else if(dv>21||pv>dv) result='WIN'; else if(pv===dv) result='PUSH'; return {player,dealer,pv,dv,result}; }
function render(cards){ return cards.map(c=>`${c.rank}${c.suit}`).join('  '); }
module.exports = { play, render, value };
