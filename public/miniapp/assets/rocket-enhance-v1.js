/* Bika Rocket visual enhancement v2 — presentation only. Server remains source of truth. */
(function(){
  'use strict';
  function install(){
    if(document.getElementById('bikaRocketFlightV2')) return true;
    const style=document.createElement('style');
    style.id='bikaRocketFlightV2';
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
    `;
    document.head.appendChild(style);
    return true;
  }
  install();
  window.setInterval(install,500);
})();
