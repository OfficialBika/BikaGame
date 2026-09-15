/* BIKA ROCKET PRO — state animation only. Visual styling lives in rocket-pro-v2.css. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  function point(progress){
    const scene=$('rocketScene'),path=scene&&scene.querySelector('.flight-path path');
    if(!scene||!path||typeof path.getTotalLength!=='function')return null;
    const vb=path.ownerSVGElement.viewBox.baseVal,len=path.getTotalLength(),p=Math.max(0,Math.min(.96,Number(progress)||0));
    const pt=path.getPointAtLength(len*p),sx=scene.clientWidth/(vb.width||420),sy=scene.clientHeight/(vb.height||260),d=Math.max(2,len*.004);
    const a=path.getPointAtLength(Math.max(0,len*p-d)),b=path.getPointAtLength(Math.min(len,len*p+d));
    return{x:pt.x*sx,y:pt.y*sy,angle:Math.atan2((b.y-a.y)*sy,(b.x-a.x)*sx)*180/Math.PI};
  }
  function move(){
    const scene=$('rocketScene'),ship=$('rocketShip');if(!scene||!ship)return;
    const state=scene.classList.contains('running')?'running':scene.classList.contains('crashed')?'crashed':'betting';
    const progress=state==='betting'?0:Math.max(0,Math.min(.96,parseFloat(getComputedStyle(scene).getPropertyValue('--rocket-progress'))||0));
    const p=point(progress);if(!p)return;
    ship.style.left=p.x+'px';ship.style.top=p.y+'px';ship.style.setProperty('--rocket-angle',(p.angle-2)+'deg');ship.style.setProperty('--rocket-scale',(0.92+progress*.12).toFixed(3));
  }
  function hud(data){
    const scene=$('rocketScene'),round=data&&data.round;if(!scene||!round)return;
    let h=$('rocketProHud');if(!h){h=document.createElement('div');h.id='rocketProHud';h.className='rocket-pro-hud';scene.appendChild(h)}
    const s=String(round.state||'betting');h.innerHTML='<i></i><b>'+(s==='running'?'FLIGHT IN PROGRESS':s==='crashed'?'ROUND CRASHED':'BETTING OPEN')+'</b><span>ROUND #'+String(round.no==null?'—':round.no)+'</span>';
  }
  function hook(){
    if(window.__bikaRocketProHook)return;const native=window.fetch;if(typeof native!=='function')return;
    window.fetch=function(input,init){const url=typeof input==='string'?input:(input&&input.url)||'',req=native.call(this,input,init);if(String(url).includes('/api/mini/crash/status'))req.then(r=>r.clone().json().then(d=>{window.__bikaCrashSnapshot=d;hud(d)}).catch(()=>{})).catch(()=>{});return req};window.__bikaRocketProHook=true;
  }
  function loop(){move();requestAnimationFrame(loop)}
  hook();hud(window.__bikaCrashSnapshot);loop();
})();