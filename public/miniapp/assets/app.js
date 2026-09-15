/* Compatibility bridge for the legacy /miniapp/assets/app.js URL. */
(function loadCanonicalBikaMiniApp(){
  'use strict';
  function loadSync(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) { (0, eval)(xhr.responseText); return; }
    throw new Error('Mini App asset unavailable: HTTP ' + xhr.status);
  }
  function loadRocketCssLast() {
    const old = document.getElementById('bikaRocketProCss');
    if (old) old.remove();
    const link = document.createElement('link');
    link.id = 'bikaRocketProCss';
    link.rel = 'stylesheet';
    link.href = '/miniapp/rocket-pro-v2.css?v=20260916-pro4';
    document.head.appendChild(link);
  }
  try {
    loadSync('/miniapp/app.js?v=premium-v15-shan-pro');
    loadSync('/miniapp/assets/bj-enhance.js?v=20260915');
    loadSync('/miniapp/assets/wallet-history.js?v=20260915');
    loadSync('/miniapp/assets/rocket-enhance-v1.js?v=20260916-pro');
    const ensureRocketCssIsLast = () => {
      if (document.getElementById('bika-arena-v31')) loadRocketCssLast();
      else setTimeout(ensureRocketCssIsLast, 50);
    };
    ensureRocketCssIsLast();
  } catch (err) {
    console.error('[BikaGame] Mini App compatibility/enhancement load failed', err);
    throw err;
  }
})();