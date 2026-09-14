/* BIKA GAME — Premium Flow v19
 * Game-by-game lifecycle rail. UI-only; preserves existing handlers/API contracts.
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
  const panelText = panel => norm(panel?.innerText || '');
  const buttons = panel => [...(panel?.querySelectorAll('button,[role="button"]') || [])]
    .filter(b => !b.closest('#soundDock')).map(b => ({ el:b, text:norm(b.textContent), disabled:!!b.disabled }));

  function hasAny(text, words){ return words.some(w => text.includes(w)); }
  function buttonState(list, words){ return list.some(x => hasAny(x.text, words)); }

  function detect(id, panel){
    const t = panelText(panel), bs = buttons(panel);
    const disabled = words => buttonState(bs.filter(x=>x.disabled), words);
    const enabled = words => buttonState(bs.filter(x=>!x.disabled), words);

    if (id === 'crash') {
      if (hasAny(t,['crashed','round crashed','crash'])) return 4;
      if (enabled(['cash out','cashout'])) return 3;
      if (hasAny(t,['live','multiplier','running','in progress'])) return 2;
      if (disabled(['launch','start','place bet']) || enabled(['launch','start'])) return 1;
      return 0;
    }
    if (id === 'slot') {
      if (hasAny(t,['jackpot','payout','won','win','result'])) return 3;
      if (disabled(['spin']) || hasAny(t,['spinning','reel'])) return 2;
      return 0;
    }
    if (id === 'blackjack') {
      if (hasAny(t,['blackjack','bust','dealer wins','you win','push','result'])) return 4;
      if (enabled(['hit','stand','double','split'])) return 3;
      if (hasAny(t,['your turn','turn'])) return 2;
      if (hasAny(t,['dealing','deal','cards'])) return 1;
      return 0;
    }
    if (id === 'shan') {
      if (hasAny(t,['reveal','result','winner','win','lose','payout'])) return 4;
      if (hasAny(t,['your turn','turn','drawing','stay'])) return 3;
      if (hasAny(t,['bet','stake','banker'])) return 1;
      if (hasAny(t,['join','create room','room'])) return 0;
      return 0;
    }
    if (id === 'plinko') {
      if (hasAny(t,['payout','won','result','multiplier'])) return 4;
      if (hasAny(t,['multiplier','x'])) return 3;
      if (hasAny(t,['bounce','dropping','drop'])) return 2;
      return 0;
    }
    if (id === 'wheel') {
      if (hasAny(t,['reward','won','payout','result'])) return 3;
      if (disabled(['spin']) || hasAny(t,['spinning','spinning...'])) return 2;
      if (enabled(['spin','daily spin'])) return 1;
      return 0;
    }
    if (id === 'mines') {
      if (hasAny(t,['mine hit','boom','game over','lost','result'])) return 4;
      if (enabled(['cash out','cashout'])) return 3;
      if (hasAny(t,['gem','mine','opened','safe'])) return 2;
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
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
