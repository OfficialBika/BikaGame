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
  try {
    const rocketCss = document.createElement('link');
    rocketCss.id = 'bikaRocketProCss';
    rocketCss.rel = 'stylesheet';
    rocketCss.href = '/miniapp/rocket-pro-v2.css?v=20260916-pro3';
    document.head.appendChild(rocketCss);
    loadSync('/miniapp/app.js?v=premium-v15-shan-pro');
    loadSync('/miniapp/assets/bj-enhance.js?v=20260915');
    loadSync('/miniapp/assets/wallet-history.js?v=20260915');
    loadSync('/miniapp/assets/rocket-enhance-v1.js?v=20260916-pro');
  } catch (err) {
    console.error('[BikaGame] Mini App compatibility/enhancement load failed', err);
    throw err;
  }
})();