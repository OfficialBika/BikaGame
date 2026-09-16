/* BIKA ROCKET PRO V5 — visual-only controller. Never changes crash/RTP/bet logic. */
(()=>{
  'use strict';
  if(window.__bikaRocketV5)return; window.__bikaRocketV5=true;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const num=s=>{const m=String(s||'').replace(/,/g,'').match(/(\d+(?:\.\d+)?)/);return m?Number(m[1]):1};
  function mount(){
    const scene=document.querySelector('#crash .rocket-scene');
    if(!scene)return false;
    const ship=scene.querySelector('.ship');
    if(!ship)return false;
    ship.querySelectorAll('.ship-body').forEach((x,i)=>{if(i>0)x.remove()});
    let body=ship.querySelector('.ship-body');
    if(!body){body=document.createElement('span');body.className='ship-body';ship.appendChild(body)}
    if(!body.querySelector('span'))body.appendChild(document.createElement('span'));
    const hud=scene.querySelector('.rocket-multiplier');
    let lastRound='';
    let x=12,y=88,angle=-35;
    const reset=()=>{x=10;y=88;angle=-35;ship.style.setProperty('--rocket-angle',angle+'deg');ship.style.setProperty('--rocket-scale','.82');ship.style.left=x+'%';ship.style.top=y+'%';ship.dataset.v5State='idle'};
    const frame=()=>{
      if(!document.body.contains(scene)){window.__bikaRocketV5=false;return}
      const text=hud?.textContent||'';
      const mult=num(text);
      const state=scene.classList.contains('crashed')?'crashed':scene.classList.contains('running')?'running':scene.classList.contains('betting')?'betting':'';
      const round=scene.dataset.round||scene.querySelector('[data-round]')?.textContent||'';
      if(round && round!==lastRound){lastRound=round;reset()}
      if(state==='crashed'){ship.style.left=x+'%';ship.style.top=y+'%';ship.style.setProperty('--rocket-angle',angle+'deg');ship.dataset.v5State='crashed'}
      else if(state==='running'){
        /* Logarithmic travel keeps early motion near the bottom and prevents high targets from jumping upward. */
        const t=clamp(Math.log(Math.max(1,mult))/Math.log(30),0,1);
        const ease=t*t*(3-2*t);
        const nx=10+70*ease;
        const ny=88-67*ease;
        const dx=nx-x,dy=ny-y;
        x+=dx*.13;y+=dy*.13;
        angle=Math.atan2(dy,dx)*180/Math.PI;
        ship.style.left=x+'%';ship.style.top=y+'%';ship.style.setProperty('--rocket-angle',clamp(angle,-55,12)+'deg');ship.style.setProperty('--rocket-scale',(0.82+ease*.10).toFixed(3));ship.dataset.v5State='running';
      }else if(state==='betting'){reset();ship.dataset.v5State='betting'}
      requestAnimationFrame(frame);
    };
    reset(); requestAnimationFrame(frame); return true;
  }
  const start=()=>{if(mount())return;setTimeout(start,300)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
