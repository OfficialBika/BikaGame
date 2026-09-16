/* BIKA ROCKET PRO V5 — visual-only movement controller. Game/RTP/bet logic untouched. */
(function(){
  'use strict';
  if(window.__bikaRocketMovementV5)return; window.__bikaRocketMovementV5=true;
  const $=id=>document.getElementById(id),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function mult(scene){const el=scene.querySelector('.rocket-multiplier');const m=String(el?.textContent||'').replace(/,/g,'').match(/(\d+(?:\.\d+)?)/);return m?Number(m[1]):1}
  function move(){const scene=$('rocketScene'),ship=$('rocketShip');if(!scene||!ship)return;const state=scene.classList.contains('running')?'running':scene.classList.contains('crashed')?'crashed':'betting';if(state==='betting'){ship.style.left='9%';ship.style.top='88%';ship.style.setProperty('--rocket-angle','-34deg');ship.style.setProperty('--rocket-scale','.82');return}const css=parseFloat(getComputedStyle(scene).getPropertyValue('--rocket-progress'));const p=Number.isFinite(css)&&css>0?clamp(css,0,.96):clamp(Math.log(Math.max(1,mult(scene)))/Math.log(30),0,.96);const e=p*p*(3-2*p);const x=9+72*e,y=88-68*e;const dx=Math.max(1,72*6*p*(1-p)),dy=-68*6*p*(1-p);ship.style.left=x+'%';ship.style.top=y+'%';ship.style.setProperty('--rocket-angle',clamp(Math.atan2(dy,dx)*180/Math.PI,-48,4)+'deg');ship.style.setProperty('--rocket-scale',(0.82+e*.12).toFixed(3));ship.dataset.v5State=state}
  function hud(){const scene=$('rocketScene');if(!scene)return;let h=$('rocketProHud');if(!h){h=document.createElement('div');h.id='rocketProHud';h.className='rocket-pro-hud';scene.appendChild(h)}const state=scene.classList.contains('running')?'FLIGHT IN PROGRESS':scene.classList.contains('crashed')?'ROUND CRASHED':'BETTING OPEN';h.innerHTML='<i></i><b>'+state+'</b>'}
  function loop(){move();hud();requestAnimationFrame(loop)}loop();
})();
