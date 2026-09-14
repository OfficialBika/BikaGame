/* BIKA GAME — Premium Flow v19
 * Game-by-game lifecycle rail. UI-only; preserves existing handlers/API contracts.
 * v19.1 hardens phase detection to avoid matching static panel titles/labels.
 */
(function premiumFlowV19(){
  'use strict';

  const GAMES = {
    crash: { label:'Rocket Crash', steps:['Bet','Launch','Live','Cashout','Crash'] },
    slot: { label:'Premium Slot', steps:['Bet','Spin','Reels','Result'] },
    blackjack: { label:'Blackjack', steps:['Join','Deal','Your Turn','Stand/Hit','Result'] },
    shan: { label:'Shan Koe Mee', steps:['Join/Create','Bet','Turn','Reveal','Result'] },
    plinko: { label:'Plinko', steps:['Bet','Drop','Bounce','Multiplier','Payout'] },
    wheel: { label:'Lucky Wheel', steps:['Bet','Spin','Stop','Reward'] },
    mines: { label:'Web Mines', steps:['Bet','Open','Gem/Mine','Cashout','Result'] }
  };

  const norm = s => String(s || '').replace(/\s+/g,' ').trim().toLowerCase();
  const contentText = panel => {
    if (!panel) return '';
    const clone = panel.cloneNode(true);
    clone.querySelectorAll('.v19-flow-rail,.game-header,.panel-header,h1,h2,h3,[aria-label="Primary navigation"],#soundDock').forEach(el=>el.remove());
    return norm(clone.innerText || '');
  };
  const buttons = panel => [...(panel?.querySelectorAll('button,[role="button"]') || [])]
    .filter(b => !b.closest('#soundDock') && !b.closest('.v19-flow-rail'))
    .map(b => ({ el:b, text:norm(b.textContent), disabled:!!b.disabled }));
  const hasAny = (text, words) => words.some(w => text.includes(w));
  const buttonState = (list, words) => list.some(x => hasAny(x.text, words));

  function detect(id, panel){
    const t = contentText(panel), bs = buttons(panel);
    const disabled = words => buttonState(bs.filter(x=>x.disabled), words);
    const enabled = words => buttonState(bs.filter(x=>!x.disabled), words);

    if (id === 'crash') {
      if (hasAny(t,['round crashed','crashed at','round ended','crash point'])) return 4;
      if (enabled(['cash out','cashout'])) return 3;
      if (hasAny(t,['live','multiplier','running','in progress'])) return 2;
      if (disabled(['launch','start','place bet']) || enabled(['launch','start'])) return 1;
      return 0;
    }
    if (id === 'slot') {
      if (hasAny(t,['jackpot','payout','won','you win','result'])) return 3;
      if (disabled(['spin']) || hasAny(t,['spinning','reels spinning'])) return 2;
      if (enabled(['spin'])) return 1;
      return 0;
    }
    if (id === 'blackjack') {
      if (hasAny(t,['dealer wins','you win','you lose','push','bust','blackjack!','round result'])) return 4;
      if (enabled(['hit','stand','double','split'])) return 3;
      if (hasAny(t,['your turn','player turn'])) return 2;
      if (hasAny(t,['dealing','dealer card','initial cards'])) return 1;
      if (enabled(['join','join table','deal'])) return 0;
      return 0;
    }
    if (id === 'shan') {
      if (hasAny(t,['round result','winner','payout','you win','you lose','reveal result'])) return 4;
      if (hasAny(t,['your turn','player turn','drawing','stay'])) return 3;
      if (hasAny(t,['place bet','bet amount','stake','banker'])) return 1;
      return 0;
    }
    if (id === 'plinko') {
      if (hasAny(t,['payout','win amount','result'])) return 4;
      if (hasAny(t,['landed at','multiplier result','final multiplier'])) return 3;
      if (hasAny(t,['bounce','dropping','ball dropped'])) return 2;
      if (enabled(['drop','play','place bet'])) return 1;
      return 0;
    }
    if (id === 'wheel') {
      if (hasAny(t,['reward','won','payout','spin result'])) return 3;
      if (disabled(['spin']) || hasAny(t,['spinning...','wheel spinning'])) return 2;
      if (enabled(['spin','daily spin'])) return 1;
      return 0;
    }
    if (id === 'mines') {
      if (hasAny(t,['mine hit','boom','game over','lost','round result'])) return 4;
      if (enabled(['cash out','cashout'])) return 3;
      if (hasAny(t,['gem found','mine opened','opened','safe'])) return 2;
      if (enabled(['open','start','play'])) return 1;
      return 0;
    }
    return 0;
  }

  function ensureRail(panel, id){
    if (!panel || !GAMES[id]) return null;
    let rail = panel.querySelector('.v19-flow-rail');
    if (rail) return rail;
    rail = document.createElement('div');
    rail.className = 'v19-flow-rail';
    rail.setAttribute('aria-label', `${GAMES[id].label} game progress`);
    rail.innerHTML = `<div class="v19-flow-head"><strong>${GAMES[id].label}</strong><span class="v19-flow-phase">READY</span></div><div class="v19-flow-steps">${GAMES[id].steps.map((s,i)=>`<span data-step="${i}"><i>${i+1}</i><b>${s}</b></span>`).join('')}</div>`;
    const first = panel.querySelector('.game-header, .panel-header, h1, h2, h3');
    if (first?.parentElement) first.parentElement.insertBefore(rail, first.nextSibling);
    else panel.prepend(rail);
    return rail;
  }

  function sync(id){
    const panel = document.getElementById(id);
    if (!panel || !panel.classList.contains('active')) return;
    const rail = ensureRail(panel,id); if (!rail) return;
    const idx = detect(id,panel);
    const phase = GAMES[id].steps[idx] || GAMES[id].steps[0];
    rail.dataset.activeStep = String(idx);
    const phaseEl = rail.querySelector('.v19-flow-phase');
    if (phaseEl) phaseEl.textContent = phase.toUpperCase();
    rail.querySelectorAll('[data-step]').forEach((el,i)=>{
      el.classList.toggle('is-done', i < idx);
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-upcoming', i > idx);
    });
  }

  function syncAll(){ Object.keys(GAMES).forEach(id=>sync(id)); }

  function loadV20(){
    if (document.querySelector('script[data-bika-flow-v20]')) return;
    const style=document.createElement('link'); style.rel='stylesheet'; style.href='/miniapp/premium-flow-v20.css?v=1'; style.dataset.bikaFlowV20='1'; document.head.appendChild(style);
    const script=document.createElement('script'); script.src='/miniapp/premium-flow-v20.js?v=1'; script.dataset.bikaFlowV20='1'; document.body.appendChild(script);
  }

  function bind(){
    syncAll();
    const observer = new MutationObserver(mutations=>{
      let relevant=false;
      for(const m of mutations){
        const el=m.target instanceof Element ? m.target : m.target.parentElement;
        if(el && Object.keys(GAMES).some(id=>el.closest?.(`#${id}`))) { relevant=true; break; }
      }
      if(relevant) syncAll();
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','class','value']});
    setInterval(syncAll,1200);
    loadV20();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
