const SUITS=['♠','♥','♦','♣']; const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function buildDeck(){ const d=[]; for(const suit of SUITS) for(const rank of RANKS) d.push({rank,suit}); return d; }
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function draw(deck,n){ return deck.splice(0,n); }
function rankValue(r){ if(r==='A')return 1; if(['10','J','Q','K'].includes(r))return 0; return Number(r)||0; }
function points(cards){ return cards.reduce((s,c)=>s+rankValue(c.rank),0)%10; }
function info(cards){ const sameRank=cards.every(c=>c.rank===cards[0].rank), zat=cards.every(c=>['J','Q','K'].includes(c.rank)), sameSuit=cards.every(c=>c.suit===cards[0].suit); const p=points(cards); if(sameRank)return{cat:4,name:'Shan Koe Mee',points:p}; if(zat)return{cat:3,name:'Zat Toe',points:p}; if(sameSuit)return{cat:2,name:'Suit Triple',points:p}; return{cat:1,name:`Point ${p}`,points:p}; }
function high(r){ return r==='A'?1:r==='J'?11:r==='Q'?12:r==='K'?13:Number(r)||0; }
function compare(a,b){ const A=info(a),B=info(b); if(A.cat!==B.cat)return{winner:A.cat>B.cat?'A':'B',infoA:A,infoB:B}; if(A.points!==B.points)return{winner:A.points>B.points?'A':'B',infoA:A,infoB:B}; const ar=a.map(c=>high(c.rank)).sort((x,y)=>y-x), br=b.map(c=>high(c.rank)).sort((x,y)=>y-x); for(let i=0;i<3;i++){ if(ar[i]!==br[i])return{winner:ar[i]>br[i]?'A':'B',infoA:A,infoB:B}; } return{winner:'TIE',infoA:A,infoB:B}; }
function deal(){ const d=shuffle(buildDeck()); const A=draw(d,3), B=draw(d,3); return {cardsA:A,cardsB:B,result:compare(A,B)}; }
function render(cards){ return cards.map(c=>`${c.rank}${c.suit}`).join('  '); }
module.exports = { deal, render, info, compare };
