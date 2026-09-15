/* Bika Rocket Motion v33
 * Visual-only flight layer. It deliberately uses CSS `translate` instead of
 * `transform`, so the core renderer remains authoritative and can still update
 * its own transform. No server/game outcome logic is touched.
 */
(() => {
  const SELECTOR = '.rocket-scene .ship';
  let ship = null;
  let raf = 0;
  let startedAt = 0;
  let lastScene = false;

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function findShip() {
    const next = document.querySelector(SELECTOR);
    if (next !== ship) {
      ship = next;
      startedAt = performance.now();
      if (ship) {
        ship.style.setProperty('--bika-flight-y', '0px');
        ship.style.setProperty('--bika-flight-x', '0px');
        ship.style.setProperty('translate', 'var(--bika-flight-x) var(--bika-flight-y)');
        ship.style.willChange = 'transform, translate';
      }
    }
    return ship;
  }

  function tick(now) {
    const el = findShip();
    if (el) {
      const scene = el.closest('.rocket-scene');
      const visible = !!scene && scene.getClientRects().length > 0;
      if (visible && !lastScene) startedAt = now;
      if (!visible) startedAt = now;
      lastScene = visible;

      if (visible) {
        const elapsed = Math.max(0, (now - startedAt) / 1000);
        // Smooth, deliberately outcome-independent flight curve.
        // The rocket visibly climbs from the beginning instead of appearing frozen.
        const progress = 1 - Math.exp(-elapsed * 0.20);
        const y = -clamp(progress * 210, 0, 210);
        const x = Math.sin(elapsed * 1.15) * 7 + Math.sin(elapsed * 0.43) * 3;
        el.style.setProperty('--bika-flight-y', `${y.toFixed(2)}px`);
        el.style.setProperty('--bika-flight-x', `${x.toFixed(2)}px`);
      } else {
        el.style.setProperty('--bika-flight-y', '0px');
        el.style.setProperty('--bika-flight-x', '0px');
      }
    }
    raf = requestAnimationFrame(tick);
  }

  function boot() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
