/* Bika Rocket visual enhancement v4 — exact path flight, 8s betting, smooth live position. */
(function(){
  'use strict';

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);
    });
  }

  function installFlightStyle(){
    if(document.getElementById('bikaRocketFlightV4')) return true;
    const style=document.createElement('style');
    style.id='bikaRocketFlightV4';
    style.textContent=`
      html body .app-shell .rocket-scene .ship{
        position:absolute!important;
        left:0!important;
        top:0!important;
        bottom:auto!important;
        width:70px!important;
        height:70px!important;
        margin:0!important;
        display:block!important;
        transform-origin:50% 50%!important;
        transform:translate3d(-50%,-50%,0) rotate(var(--rocket-angle,-6deg)) scale(var(--rocket-scale,.94))!important;
        translate:0 0!important;
        transition:none!important;
        animation:none!important;
        z-index:5!important;
        pointer-events:none!important;
      }
      html body .app-shell .rocket-scene .ship::before{display:none!important}
      html body .app-shell .rocket-scene .ship::after{display:none!important}
      html body .app-shell .rocket-scene .ship .ship-body{
        position:absolute!important;
        left:14px!important;
        top:18px!important;
        width:43px!important;
        height:30px!important;
        border-radius:58% 46% 46% 58%!important;
        background:linear-gradient(145deg,#fff 0%,#dce7f4 35%,#7f9ab7 70%,#334861 100%)!important;
        border:2px solid rgba(255,255,255,.72)!important;
        box-shadow:inset -5px -5px 9px rgba(7,18,35,.28),0 5px 18px rgba(0,0,0,.42),0 0 18px rgba(53,233,255,.22)!important;
        transform:rotate(-2deg)!important;
      }
      html body .app-shell .rocket-scene .ship .ship-body::before{
        content:"";position:absolute;right:7px;top:7px;width:11px;height:11px;border-radius:50%;
        background:radial-gradient(circle at 35% 30%,#fff 0 16%,#62eaff 22% 55%,#2678ff 70% 100%);
        border:1px solid rgba(255,255,255,.7);box-shadow:0 0 10px rgba(53,233,255,.8);
      }
      html body .app-shell .rocket-scene .ship .ship-body::after{
        content:"";position:absolute;left:-13px;top:9px;width:17px;height:12px;
        background:linear-gradient(90deg,transparent,#ff315b 65%,#fff);clip-path:polygon(100% 50%,0 0,28% 50%,0 100%);
        filter:drop-shadow(0 0 7px rgba(255,49,91,.75));
      }
      html body .app-shell .rocket-scene .ship .ship-body span{
        position:absolute!important;left:9px!important;bottom:-9px!important;width:19px!important;height:19px!important;
        background:linear-gradient(135deg,#35e9ff,#fff 42%,#ff315b 72%,transparent)!important;
        clip-path:polygon(100% 50%,0 0,27% 50%,0 100%)!important;
        transform:rotate(180deg)!important;filter:blur(.2px) drop-shadow(0 0 9px rgba(255,49,91,.7));
      }
      html body .app-shell .rocket-scene .flight-path{opacity:.30!important;filter:drop-shadow(0 0 5px rgba(53,233,255,.55))!important}
      html body .app-shell .rocket-scene.betting .ship{--rocket-x:38px;--rocket-y:222px;--rocket-angle:-7deg;--rocket-scale:.94}
      html body .app-shell .rocket-scene.crashed .ship{--rocket-scale:1.04}
    `;
    document.head.appendChild(style);
    return true;
  }

  function scenePoint(progress){
    const scene=document.getElementById('rocketScene');
    const path=scene?.querySelector('.flight-path path');
    if(!scene || !path || typeof path.getTotalLength!=='function') return null;
    const svg=path.ownerSVGElement;
    const length=path.getTotalLength();
    const p=Math.max(0,Math.min(.96,Number(progress)||0));
    const point=path.getPointAtLength(length*p);
    const vb=svg.viewBox?.baseVal;
    const sx=scene.clientWidth/(vb?.width||420);
    const sy=scene.clientHeight/(vb?.height||260);
    const x=point.x*sx;
    const y=point.y*sy;
    const delta=Math.min(2,length*.008);
    const before=path.getPointAtLength(Math.max(0,length*p-delta));
    const after=path.getPointAtLength(Math.min(length,length*p+delta));
    const angle=Math.atan2((after.y-before.y)*sy,(after.x-before.x)*sx)*180/Math.PI;
    return {x,y,angle};
  }

  function updateRocketPosition(){
    const scene=document.getElementById('rocketScene');
    const ship=document.getElementById('rocketShip');
    if(!scene || !ship) return;
    const state=String(scene.className).includes('running') ? 'running' : String(scene.className).includes('crashed') ? 'crashed' : 'betting';
    const progress=state==='betting' ? 0 : Math.max(0,Math.min(.96,parseFloat(getComputedStyle(scene).getPropertyValue('--rocket-progress'))||0));
    const point=scenePoint(progress);
    if(!point) return;
    ship.style.left=point.x+'px';
    ship.style.top=point.y+'px';
    ship.style.setProperty('--rocket-angle',(point.angle-2)+'deg');
    ship.style.setProperty('--rocket-scale',String(.94+.10*progress));
  }

  function startMotion(){
    if(window.__bikaRocketV4Raf) return;
    const tick=function(){ updateRocketPosition(); window.__bikaRocketV4Raf=requestAnimationFrame(tick); };
    window.__bikaRocketV4Raf=requestAnimationFrame(tick);
  }

  function captureCrashStatus(){
    if(window.__bikaRocketFetchV4) return true;
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
    window.__bikaRocketFetchV4=true;
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
      list.innerHTML=state==='running' ? '<div class="result muted">No active bets — be first.</div>' : state==='betting' ? '<div class="result muted">Waiting for players…</div>' : '<div class="result muted">Round finished.</div>';
      return;
    }
    list.innerHTML=round.players.map(function(p){
      const bet=Math.max(0,Number(p?.bet || 0));
      const name=escapeHtml(p?.name || 'Player');
      const me=p?.me ? ' me' : '';
      const cashed=!!p?.cashedOut;
      const cashoutM=Math.max(0,Number(p?.cashoutMultiplier || 0));
      const payout=Math.max(0,Number(p?.payout || 0));
      let detail=''; let total='';
      if(cashed){ detail=bet.toLocaleString()+' × x'+cashoutM.toFixed(2); total=payout.toLocaleString()+' '+coin; }
      else if(state==='running'){ detail=bet.toLocaleString()+' × x'+current.toFixed(2); total=Math.floor(bet*current).toLocaleString()+' '+coin; }
      else if(state==='crashed'){ detail=bet.toLocaleString()+' × x'+current.toFixed(2); total='BUST'; }
      else { detail=bet.toLocaleString()+' '+coin; total='Waiting'; }
      return '<div class="player-row'+me+'"><span><span>'+ (cashed?'✅':'⏳') +' '+name+'</span><small class="rocket-player-bet">'+detail+'</small></span><b class="rocket-player-total">'+total+'</b></div>';
    }).join('');
  }

  function install(){ installFlightStyle(); captureCrashStatus(); startMotion(); renderLivePlayers(window.__bikaCrashSnapshot); updateRocketPosition(); return true; }
  install();
  window.setInterval(install,500);
})();
