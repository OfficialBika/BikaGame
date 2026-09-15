/* BikaGame Premium UX v17
 * Non-invasive interaction layer: Telegram haptics, button feedback,
 * result-state feedback, and safe busy-state affordances.
 * No game API or game logic is replaced.
 */
(function premiumUXV17(){
  'use strict';

  const tg = () => window.Telegram?.WebApp;
  const recent = new WeakMap();

  function haptic(type = 'selection') {
    try {
      const webApp = tg();
      const impact = webApp?.HapticFeedback;
      if (!impact) return;
      if (type === 'success' || type === 'error' || type === 'warning') {
        impact.notificationOccurred(type);
      } else if (type === 'light' || type === 'medium' || type === 'heavy') {
        impact.impactOccurred(type);
      } else {
        impact.selectionChanged();
      }
    } catch (_) {}
  }

  function buttonFeedback(btn) {
    if (!btn || btn.disabled) return;
    const now = Date.now();
    const last = recent.get(btn) || 0;
    if (now - last < 90) return;
    recent.set(btn, now);
    haptic(btn.matches('#cashoutBtn,#spinBtn') ? 'medium' : 'light');
  }

  function observeResults() {
    const selectors = [
      '#crashState','#crashMultiplier','#slotResult','#blackjackResult','#shanResult',
      '#plinkoResult','#wheelResult','#minesResult'
    ];
    const nodes = selectors.map((s) => document.querySelector(s)).filter(Boolean);
    if (!nodes.length || !window.MutationObserver) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        const text = String(target.textContent || '').trim().toLowerCase();
        if (!text) continue;
        if (/win|won|success|jackpot|safe|cash|profit/.test(text)) {
          haptic('success');
          return;
        }
        if (/lose|lost|crash|boom|mine|error|failed/.test(text)) {
          haptic('error');
          return;
        }
      }
    });
    nodes.forEach((node) => observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true }));
  }

  function enhanceButtons() {
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('button,[role="button"]');
      if (btn) buttonFeedback(btn);
    }, { passive: true });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const btn = event.target.closest('button,[role="button"]');
      if (btn) buttonFeedback(btn);
    }, { passive: true });
  }

  function addBusyGuard() {
    const submitLike = new Set([
      'crashStartBtn','cashoutBtn','spinBtn','bjJoinBtn','bjHitBtn','bjStandBtn',
      'shanJoinBtn','shanDrawBtn','shanStayBtn','plinkoDropBtn','wheelSpinBtn','minesStartBtn'
    ]);
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn || !submitLike.has(btn.id) || btn.disabled) return;
      btn.classList.add('v17-pressed');
      window.setTimeout(() => btn.classList.remove('v17-pressed'), 180);
    }, { passive: true });
  }

  function boot() {
    enhanceButtons();
    addBusyGuard();
    // The legacy app creates game controls dynamically, so observe after the
    // current DOM settles and retry once for late-mounted panels.
    observeResults();
    window.setTimeout(observeResults, 700);
    window.setTimeout(observeResults, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
