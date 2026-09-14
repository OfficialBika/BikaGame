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
    loadSync('/miniapp/app.js?v=premium-v15-shan-pro');
    loadSync('/miniapp/assets/bj-enhance.js?v=20260915');
  } catch (err) {
    console.error('[BikaGame] Mini App compatibility/enhancement load failed', err);
    throw err;
  }
})();
