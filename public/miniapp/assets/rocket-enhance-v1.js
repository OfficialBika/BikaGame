/* BIKA ROCKET PRO v5 — cinematic crash-game presentation, exact SVG flight, live players. */
(function(){
  'use strict';

  const $=(id)=>document.getElementById(id);
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function installStyle(){
    if($('bikaRocketProV5')) return;
    const s=document.createElement('style'); s.id='bikaRocketProV5';
    s.textContent=`
      html body .app-shell .rocket-stage{background:linear-gradient(145deg,#050912,#081323 55%,#120914)!important;border:1px solid rgba(72,220,255,.20)!important;box-shadow:0 20px 55px rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.06)!important}
      html body .app-shell .rocket-scene{position:relative!important;isolation:isolate!important;overflow:hidden!important;min-height:260px!important;background:radial-gradient(circle at 72% 18%,rgba(53,233,255,.13),transparent 24%),radial-gradient(circle at 12% 78%,rgba(255,49,91,.10),transparent 28%),linear-gradient(180deg,#050a15,#071221 60%,#03060d)!important;border-radius:18px!important}
      html body .app-shell .rocket-scene:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 100%,rgba(53,233,255,.08),transparent 42%),linear-gradient(110deg,transparent 0 48%,rgba(255,255,255,.025) 50%,transparent 52%);pointer-events:none;z-index:0}
      html body .app-shell .rocket-scene:after{content:"";position:absolute;left:0;right:0;bottom:0;height:35%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.25));pointer-events:none;z-index:0}
      html body .app-shell .rocket-scene .stars{opacity:.72!important}
      html body .app-shell .rocket-scene .planet{opacity:.42!important;filter:blur(.2px)!important}
      html body .app-shell .rocket-scene .launch-pad{opacity:.78!important}
      html body .app-shell .rocket-scene .flight-path{opacity:.20!important;stroke-width:2.4!important;filter:drop-shadow(0 0 7px rgba(53,233,255,.70))!important}
      html body .app-shell .rocket-scene .flight-path path{stroke-dasharray:7 11!important}
      html body .app-shell .rocket-scene .ship{position:absolute!important;left:0!important;top:0!important;bottom:auto!important;width:72px!important;height:72px!important;margin:0!important;display:block!important;background:none!important;border:0!important;box-shadow:none!important;transform-origin:50% 50%!important;transform:translate3d(-50%,-50%,0) rotate(var(--rocket-angle,-7deg)) scale(var(--rocket-scale,.94))!important;translate:0 0!important;transition:none!important;animation:none!important;z-index:8!important;pointer-events:none!important;will-change:left,top,transform,filter}
      html body .app-shell .rocket-scene .ship:before,html body .app-shell .rocket-scene .ship:after{display:none!important}
      html body .app-shell .rocket-scene .ship .ship-body{position:absolute!important;left:14px!important;top:18px!important;width:45px!important;height:31px!important;border-radius:58% 46% 46% 58%!important;background:linear-gradient(145deg,#fff 0%,#e8f2fa 25%,#8ca8c2 62%,#26394e 100%)!important;border:1.5px solid rgba(255,255,255,.75)!important;box-shadow:inset -6px -5px 9px rgba(4,12,24,.35),0 6px 18px rgba(0,0,0,.46),0 0 20px rgba(53,233,255,.24)!important;transform:rotate(-2deg)!important}
      html body .app-shell .rocket-scene .ship .ship-body:before{content:"";position:absolute;right:7px;top:7px;width:11px;height:11px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0 15%,#6ef2ff 25% 54%,#2878ff 72%);border:1px solid rgba(255,255,255,.72);box-shadow:0 0 11px rgba(53,233,255,.95)}
      html body .app-shell .rocket-scene .ship .ship-body:after{content:"";position:absolute;left:-15px;top:9px;width:20px;height:13px;background:linear-gradient(90deg,transparent,#ff315b 55%,#fff);clip-path:polygon(100% 50%,0 0,28% 50%,0 100%);filter:drop-shadow(0 0 8px rgba(255,49,91,.85))}
      html body .app-shell .rocket-scene .ship .ship-body span{position:absolute!important;left:8px!important;bottom:-11px!important;width:20px!important;height:22px!important;background:linear-gradient(135deg,#35e9ff,#fff 38%,#ff315b 70%,transparent)!important;clip-path:polygon(100% 50%,0 0,25% 50%,0 100%)!important;transform:rotate(180deg)!important;filter:blur(.25px) drop-shadow(0 0 10px rgba(255,49,91,.78))!important;animation:rocketProFlame .11s ease-in-out infinite alternate!important}
      html body .app-shell .rocket-scene.running .ship{filter:drop-shadow(0 0 9px rgba(53,233,255,.32))}
      html body .app-shell .rocket-scene.crashed .ship{--rocket-scale:1.06!important;filter:drop-shadow(0 0 12px rgba(255,49,91,.5))!important}
      html body .app-shell .rocket-scene.betting .ship{--rocket-angle:-7deg!important;--rocket-scale:.94!important}
      html body .app-shell .rocket-scene.crashed .ship .ship-body span{animation:none!important;opacity:.25!important}
      html body .app-shell .rocket-scene .rocket-multiplier{z-index:10!important;font-weight:900!important;letter-spacing:-1px!important;text-shadow:0 3px 22px rgba(0,0,0,.65),0 0 22px rgba(53,233,255,.28)!important}
      html body .app-shell .rocket-scene.running .rocket-multiplier{color:#fff!important}
      html body .app-shell .rocket-scene.crashed .rocket-multiplier{color:#ff5475!important;text-shadow:0 0 26px rgba(255,49,91,.55)!important}
      html body .app-shell .rocket-scene .countdown-bubble{z-index:11!important;border:1px solid rgba(255,255,255,.15)!important;background:rgba(4,8,17,.78)!important;box-shadow:0 8px 24px rgba(0,0,0,.30),0 0 18px rgba(53,233,255,.08)!important;backdrop-filter:blur(8px)!important}
      html body .app-shell .rocket-pro-status{position:absolute;left:14px;top:12px;z-index:12;display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid rgba(255,255,255,.10);border-radius:999px;background:rgba(3,7,15,.68);font-size:10px;font-weight:900;letter-spacing:.08em;color:#d9edf7;backdrop-filter:blur(8px);box-shadow:0 8px 20px rgba(0,0,0,.22)}
      html body .app-shell .rocket-pro-status i{width:7px;height:7px;border-radius:50%;background:#35e9ff;box-shadow:0 0 10px #35e9ff}
      html body .app-shell .rocket-scene.crashed .rocket-pro-status i{background:#ff315b;box-shadow:0 0 10px #ff315b}
      html body .app-shell .rocket-crash-flash{position:absolute;inset:0;z-index:7;pointer-events:none;background:radial-gradient(circle at 74% 18%,rgba(255,255,255,.8),rgba(255,49,91,.20) 8%,transparent 32%);opacity:0}
      html body .app-shell .rocket-scene.crashed .rocket-crash-flash{animation:rocketCrashFlash .42s ease-out both}
      html body .app-shell .rocket-bet-ribbon{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;margin-top:9px!important;padding:8px 10px!important;border:1px solid rgba(53,233,255,.12)!important;border-radius:12px!important;background:rgba(4,10,20,.62)!important;font-size:11px!important;color:#9db1c5!important}
      html body .app-shell .rocket-bet-ribbon b{color:#fff!important}
      @keyframes rocketProFlame{from{transform:rotate(180deg) scaleY(.78);opacity:.72}to{transform:rotate(180deg) scaleY(1.22);opacity:1}}
      @keyframes rocketCrashFlash{0%{opacity:0;transform:scale(.82)}18%{opacity:1;transform:scale(1.03)}100%{opacity:0;transform:scale(1.08)}}
      @media(max-width:620px){html body .app-shell .rocket-scene{min-height:248px!important}.rocket-pro-status{left:10px!important;top:9px!important}}
      @media(prefers-reduced-motion:reduce){html body .app-shell .rocket-scene .ship .ship-body span{animation:none!important}.rocket-scene.crashed .rocket-crash-flash{animation:none!important;opacity:.15!important}}
    `;
    document.head.appendChild(s);
  }

  function installHud(){
    const scene=$('rocketScene'); if(!scene) return;
    if(!$('rocketProStatus')){
      const el=document.createElement('div'); el.id='rocketProStatus'; el.className='rocket-pro-status'; el.innerHTML='<i></i><span id="rocketProStatusText">LIVE ROUND</span>';
      scene.appendChild(el);
    }
    if(!$('rocketCrashFlash')){ const el=document.createElement('div'); el.id='rocketCrashFlash'; el.className='rocket-crash-flash'; scene.appendChild(el); }
    const betBox=scene.parentElement?.querySelector('.compact-bet');
    if(betBox && !$('rocketBetRibbon')){
      const r=document.createElement('div'); r.id='rocketBetRibbon'; r.className='rocket-bet-ribbon';
      r.innerHTML='<span>ROUND <b id="rocketRibbonRound">#—</b></span><span>BET <b>8s</b></span><span>LIVE</span>';
      betBox.parentElement.insertBefore(r,betBox);
    }
  }

  function scenePoint(progress){
    const scene=$('rocketScene'), path=scene?.querySelector('.flight-path path');
    if(!scene||!path||typeof path.getTotalLength!=='function') return null;
    const svg=path.ownerSVGElement, vb=svg.viewBox?.baseVal;
    const len=path.getTotalLength(), p=Math.max(0,Math.min(.96,Number(progress)||0));
    const pt=path.getPointAtLength(len*p);
    const sx=scene.clientWidth/(vb?.width||420), sy=scene.clientHeight/(vb?.height||260);
    const x=pt.x*sx, y=pt.y*sy, d=Math.min(2.5,len*.006);
    const a=path.getPointAtLength(Math.max(0,len*p-d)), b=path.getPointAtLength(Math.min(len,len*p+d));
    return {x,y,angle:Math.atan2((b.y-a.y)*sy,(b.x-a.x)*sx)*180/Math.PI};
  }

  function updatePosition(){
    const scene=$('rocketScene'), ship=$('rocketShip'); if(!scene||!ship) return;
    const cls=String(scene.className), state=cls.includes('running')?'running':cls.includes('crashed')?'crashed':'betting';
    const progress=state==='betting'?0:Math.max(0,Math.min(.96,parseFloat(getComputedStyle(scene).getPropertyValue('--rocket-progress'))||0));
    const pt=scenePoint(progress); if(!pt) return;
    ship.style.left=pt.x+'px'; ship.style.top=pt.y+'px';
    ship.style.setProperty('--rocket-angle',(pt.angle-2)+'deg');
    ship.style.setProperty('--rocket-scale',String(.94+.12*progress));
  }

  function updateHud(data){
    const round=data?.round; if(!round) return;
    const state=String(round.state||'betting');
    const st=$('rocketProStatusText'); if(st) st.textContent=state==='running'?'FLIGHT IN PROGRESS':state==='crashed'?'ROUND CRASHED':'BETTING OPEN';
    const rr=$('rocketRibbonRound'); if(rr) rr.textContent='#'+(round.no??'—');
  }

  function currentMultiplier(round){
    const t=$('crashMultiplier')?.textContent||'', m=t.match(/x\s*([0-9]+(?:\.[0-9]+)?)/i), dom=m?Number(m[1]):NaN;
    if(Number.isFinite(dom)&&dom>0) return dom;
    const sv=Number(round?.multiplier||round?.currentMultiplier||1); return Number.isFinite(sv)&&sv>0?sv:1;
  }

  function renderPlayers(data){
    const list=$('playersList'), round=data?.round; if(!list||!round||!Array.isArray(round.players)) return;
    const coin=esc(data?.coin||round?.coin||''), state=String(round.state||''), cur=currentMultiplier(round);
    if(!round.players.length){list.innerHTML=state==='running'?'<div class="result muted">No active bets — be first.</div>':state==='betting'?'<div class="result muted">Waiting for players…</div>':'<div class="result muted">Round finished.</div>';return;}
    list.innerHTML=round.players.map(p=>{
      const bet=Math.max(0,Number(p?.bet||0)), name=esc(p?.name||'Player'), cashed=!!p?.cashedOut, cm=Math.max(0,Number(p?.cashoutMultiplier||0)), payout=Math.max(0,Number(p?.payout||0));
      let detail='',total='';
      if(cashed){detail=bet.toLocaleString()+' × x'+cm.toFixed(2);total=payout.toLocaleString()+' '+coin}
      else if(state==='running'){detail=bet.toLocaleString()+' × x'+cur.toFixed(2);total=Math.floor(bet*cur).toLocaleString()+' '+coin}
      else if(state==='crashed'){detail=bet.toLocaleString()+' × x'+cur.toFixed(2);total='BUST'}
      else{detail=bet.toLocaleString()+' '+coin;total='Waiting'}
      return '<div class="player-row'+(p?.me?' me':'')+'"><span><span>'+(cashed?'✅':'⏳')+' '+name+'</span><small class="rocket-player-bet">'+detail+'</small></span><b class="rocket-player-total">'+total+'</b></div>';
    }).join('');
  }

  function hookFetch(){
    if(window.__bikaRocketFetchV5||typeof window.fetch!=='function') return;
    const native=window.fetch.bind(window);
    window.fetch=function(input,init){
      const url=typeof input==='string'?input:(input&&input.url)||'';
      const p=native(input,init);
      if(String(url).includes('/api/mini/crash/status')) p.then(r=>r.clone().json().then(data=>{window.__bikaCrashSnapshot=data;updateHud(data);renderPlayers(data)}).catch(()=>{})).catch(()=>{});
      return p;
    };
    window.__bikaRocketFetchV5=true;
  }

  function loop(){
    updatePosition(); requestAnimationFrame(loop);
  }

  function install(){installStyle();installHud();hookFetch();updateHud(window.__bikaCrashSnapshot);renderPlayers(window.__bikaCrashSnapshot);updatePosition();}
  install(); loop(); setInterval(install,700);
})();
