/* Bika Rocket visual enhancement v1 — presentation only. Server remains source of truth. */
(function(){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function install(){
    const scene=document.getElementById('rocketScene');
    if(!scene) return false;
    scene.style.setProperty('--rocket-flight-ready','1');
    return true;
  }
  function sync(){
    const scene=document.getElementById('rocketScene');
    if(!scene) return;
    const round=window.__bikaLiveRound || null;
    if(!round) return;
    const state=String(round.state||'');
    if(state==='betting'){
      scene.style.setProperty('--rocket-progress','0');
      scene.dataset.rocketPhase='betting';
      return;
    }
    if(state==='running'){
      const m=Math.max(1,Number(round.multiplier||1));
      const max=Math.max(2,Number(window.__bikaRocketVisualMax||6));
      const p=clamp(Math.log(m)/Math.log(max),0,.92);
      scene.style.setProperty('--rocket-progress',String(p));
      scene.dataset.rocketPhase='running';
      return;
    }
    if(state==='crashed'){
      scene.dataset.rocketPhase='crashed';
    }
  }
  install();
  window.setInterval(function(){ install(); sync(); },120);
  window.addEventListener('bika:rocket-state',sync);
})();
