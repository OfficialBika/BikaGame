/* Bika Rocket visual enhancement v3 — server-driven motion + live player bet x multiplier. */
(function(){
  'use strict';

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);
    });
  }

  function installFlightStyle(){
    if(document.getElementById('bikaRocketFlightV3')) return true;
    const style=document.createElement('style');
    style.id='bikaRocketFlightV3';
    style.textContent=`
      html body .app-shell .rocket-scene .ship{
        animation:none!important;
        transition:transform .16s linear,translate .16s linear,bottom .16s linear!important;
        bottom:18px!important;
        translate:0 0!important;
        transform:translate3d(0,calc(-150px * var(--rocket-progress,0)),0) rotate(-4deg) scale(calc(.94 + .10 * var(--rocket-progress,0)))!important;
      }
      html body .app-shell .rocket-scene.betting .ship{
        transform:translate3d(0,0,0) rotate(-7deg) scale(.94)!important;
      }
      html body .app-shell .rocket-scene.crashed .ship{
        transform:translate3d(0,calc(-150px * var(--rocket-progress,0)),0) rotate(-8deg) scale(1.04)!important;
      }
      html body .app-shell #playersList .player-row .rocket-player-bet{
        display:block!important;
        margin-top:2px!important;
        font-size:.72rem!important;
        line-height:1.15!important;
        opacity:.9!important;
      }
      html body .app-shell #playersList .player-row .rocket-player-total{
        font-weight:800!important;
        white-space:nowrap!important;
      }
    `;
    document.head.appendChild(style);
    return true;
  }

  function captureCrashStatus(){
    if(window.__bikaRocketFetchV3) return true;
    if(typeof window.fetch!=='function') return false;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=function(input, init){
      const requestUrl=typeof input==='string' ? input : (input && input.url) || '';
      const promise=nativeFetch(input, init);
      if(String(requestUrl).includes('/api/mini/crash/status')){
        promise.then(function(response){
          response.clone().json().then(function(data){
            window.__bikaCrashSnapshot=data;
            renderLivePlayers(data);
          }).catch(function(){});
        }).catch(function(){});
      }
      return promise;
    };
    window.__bikaRocketFetchV3=true;
    return true;
  }

  function currentDisplayedMultiplier(round){
    const text=document.getElementById('crashMultiplier')?.textContent || '';
    const match=text.match(/x\s*([0-9]+(?:\.[0-9]+)?)/i);
    const domValue=match ? Number(match[1]) : NaN;
    if(Number.isFinite(domValue) && domValue>0) return domValue;
    const serverValue=Number(round?.multiplier || 1);
    return Number.isFinite(serverValue) && serverValue>0 ? serverValue : 1;
  }

  function renderLivePlayers(data){
    const list=document.getElementById('playersList');
    const round=data?.round;
    if(!list || !round || !Array.isArray(round.players)) return;

    const coin=escapeHtml(data?.coin || round?.coin || '');
    const current=currentDisplayedMultiplier(round);
    const state=String(round.state || '');

    if(!round.players.length){
      if(state==='running') list.innerHTML='<div class="result muted">No active bets — be first.</div>';
      else if(state==='betting') list.innerHTML='<div class="result muted">Waiting for players…</div>';
      return;
    }

    list.innerHTML=round.players.map(function(p){
      const bet=Math.max(0,Number(p?.bet || 0));
      const name=escapeHtml(p?.name || 'Player');
      const me=p?.me ? ' me' : '';
      const cashed=!!p?.cashedOut;
      const cashoutM=Math.max(0,Number(p?.cashoutMultiplier || 0));
      const payout=Math.max(0,Number(p?.payout || 0));
      let detail='';
      let total='';

      if(cashed){
        detail=`${bet.toLocaleString()} × x${cashoutM.toFixed(2)}`;
        total=`${payout.toLocaleString()} ${coin}`;
      }else if(state==='running'){
        const liveTotal=Math.floor(bet*current);
        detail=`${bet.toLocaleString()} × x${current.toFixed(2)}`;
        total=`${liveTotal.toLocaleString()} ${coin}`;
      }else if(state==='crashed'){
        detail=`${bet.toLocaleString()} × x${current.toFixed(2)}`;
        total='BUST';
      }else{
        detail=`${bet.toLocaleString()} ${coin}`;
        total='Waiting';
      }

      return `<div class="player-row${me}">`+
        `<span><span>${cashed ? '✅' : '⏳'} ${name}</span><small class="rocket-player-bet">${detail}</small></span>`+
        `<b class="rocket-player-total">${total}</b>`+
      `</div>`;
    }).join('');
  }

  function install(){
    installFlightStyle();
    captureCrashStatus();
    renderLivePlayers(window.__bikaCrashSnapshot);
    return true;
  }

  install();
  window.setInterval(install,500);
})();
