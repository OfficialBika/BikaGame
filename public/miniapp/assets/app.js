/* Compatibility bridge for the legacy /miniapp/assets/app.js URL.
 * The canonical Mini App runtime lives at /miniapp/app.js.
 * Load it synchronously so the wrapper's script onload fires only after
 * the real app has registered its event handlers and initialized globals.
 */
(function loadCanonicalBikaMiniApp(){
  'use strict';
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/miniapp/app.js?v=premium-v15-shan-pro', false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      (0, eval)(xhr.responseText);
      return;
    }
    throw new Error('Canonical Mini App runtime unavailable: HTTP ' + xhr.status);
  } catch (err) {
    console.error('[BikaGame] Failed to load canonical app.js', err);
    throw err;
  }
})();
